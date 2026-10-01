# Strudel 統合 設計（v2 最小構成）

最終更新: 2026-10-01（パターンのハイライト）

v1（`archive/strudel-v1`）は参考のみ。コードは移植せず、この設計に沿って作り直す。

## 目標

各デッキ（A/B）を GLSL と Strudel で切り替えられるようにする。Strudel モードでも wavenerd の DJ 機能（ミキサー / cue / BPM 同期 / MIDI knob）がそのまま使えること。

## 決定事項

| 項目 | 決定 |
|---|---|
| ライセンス | AGPL-3.0-or-later に変更（Strudel / superdough が AGPL のため） |
| デッキ構成 | 各デッキで GLSL / Strudel を切り替え |
| superdough | fork しない。npm 版（1.3.x）を使う |
| テンポ | Strudel の 1 cycle = 1 小節（4 拍）。BPM は wavenerd-deck の BeatManager に従う |
| 反映タイミング | GLSL デッキと同じ。`Mod-S` で cue、`Mod-R` で次の小節頭に反映、`Shift-Mod-R` で即時反映 |
| 音源 | strudel.cc REPL の `prebake()` と同等のものを起動時に 1 回ロード（両デッキ共有）。ストレージのサンプルも同じ名前で鳴らせる（「ストレージのサンプル」を参照） |
| パラメータ | GLSL と同じ `knob0`〜`knob7` を Strudel コードから参照でき、MIDI 割り当てを共有する |

## アーキテクチャ

```
                         ┌─ WavenerdDeck A (GLSL) ─┐
                         │                          ├─ DeckSourceSwitch A ─→ mixer.inputA
StrudelDeck A ─ superdough(DeckOutputController A) ┘
                         （B も同様）

StrudelScheduler A/B ── 小節位置を参照 ──→ hostDeck.beatManager
```

### 1. 出力ルーティング（superdough を fork しない）

superdough の `SuperdoughAudioController` はシングルトンだが、`superdough()` は呼び出し直後（最初の await より前）に一度だけ controller を読む。そこで次のようにする。

- `SuperdoughAudioController` を継承した `DeckOutputController` を作る。`output` を差し替え、orbit の出力が `ctx.destination` ではなく各デッキのノードにつながるようにする。
  - 継承元のクラスは、`setAudioContext(audio)` の後に `getSuperdoughAudioController().constructor` で取り出す。これは main entry の dist にバンドルされたクラスそのもの。
  - ディープインポート（`superdough/superdoughoutput.mjs`）は**使わない**。`helpers.mjs` → `audioContext.mjs` と読み込まれ、dist とは別の AudioContext 保持モジュールが二重にできてしまうため（1.3.0 で確認済み）。
  - 基底クラスのコンストラクタが `ctx.destination.channelCount` を書き換えるので、元の値に戻す。
  - デフォルト controller（`ctx.destination` につながっている）は使わない。中身は空なので無音だが、`output.disconnect()` で切り離しておく。
- 発音時は `setSuperdoughAudioController(ctrlX)` を同期的に呼んでから、すぐに `webaudioOutput()` を呼ぶ。
- orbit ごとのリバーブ・ディレイ・duck は controller 単位になり、デッキ間で独立する。
- 共有されるものもある：`soundMap`、ポリフォニー上限、analyser、worklet。
- 使わない機能：`.dough()`（supradough）と `bus` シンセ。どちらもグローバルな出力を直接参照するため。

### 2. DeckSourceSwitch（`src/audio/`）

- GLSL の出力と Strudel の出力を gain で切り替えて、`mixer.inputX` に送る。
- `AudioDestinationRouter` の `deckA` / `deckB` も、ここの出力に差し替える。
- 切り替えは短いクロスフェード（約 10ms）で行う。

### 3. StrudelScheduler（自前、`src/strudel/`）

Strudel 標準の Cyclist は独自のクロックで動くため使わない。`repl` は評価（evaluate）専用にする。

- tick（約 50ms 間隔）ごとに、先読み区間 `[c0, c1)` をサイクル単位で求める。
- `pattern.queryArc(c0, c1)` を実行し、onset を持つ hap を `defaultOutput(hap, …, targetTime)` に渡す。`targetTime` は AudioContext 時刻。
- 時刻の対応（wavenerd-deck 0.9 のソースより）
  - デッキ時刻 `T` のサンプルは、AudioContext 時刻 `T + blockOffset * 128 / sampleRate` に再生される。
  - 小節位置は `beatManager.bar` / `sixteenBar` / `bpm` から求める。
  - 小節の長さは `240 / bpm` 秒。
- サイクル番号は単調増加のカウンタで持つ。`beatManager` の小節位置を基準に毎 tick 補正し、ドリフトを防ぐ。
- cue の反映
  - `Mod-R`：次のサイクル境界で `staged` を `active` に差し替える。
  - `Shift-Mod-R`：次の tick で差し替える。
- 再生・停止・巻き戻し・BPM は、そのスロットの WavenerdDeck（hostDeck の BeatManager）に従う。
- hostDeck の `rewind` イベントを受けたら、サイクルカウンタを 0 に戻す。

### 4. StrudelDeck（`src/strudel/`）

UI（Deck / DeckStatusBar / DeckEditor）から GLSL デッキと同じように扱えるよう、共通インターフェイス `CodeDeck`（`src/CodeDeck.ts`）を実装する。`WavenerdDeck` もそのまま `CodeDeck` として扱える。

- `compile(code)`
  - `repl.evaluate(code, false)` を呼ぶ。
  - 評価結果（`evaluate()` の戻り値のパターン。エラー時は `undefined`）を `staged` に保存する。`autostart=false` なら Cyclist は起動しないので、`scheduler.setPattern` の上書きは不要（M0 で確認）。
  - 状態は `compiling` → `ready` と遷移する（エラー時は `none` にして `error` を発行）。
- `applyCue()`：状態を `applying` にし、次の小節頭で反映する。状態が `ready` のときだけ受け付ける。差し替え位置は「まだ発音予定を出していない最初の cycle 境界」（`ceil(prevEnd)`）。差し替える瞬間に最新の `staged` を取り出すので、`applying` 中に再コンパイルすると新しい方が反映される（GLSL デッキと同じ）。スケジューラが止まっているとき（GLSL モード中、または hostDeck の一時停止中）は即時に反映する。
- `applyCueImmediately()`：即時に反映する。
- 巻き戻し時は、GLSL デッキと同じく `staged` を即時反映する。
- `setParam(name, value)`：knob ストアを更新する（M3）。
- 空のコードは `silence` として扱う（`repl.evaluate` は空文字で例外を投げるため）。
- `active`：スケジューラの動作/停止。GLSL モードの間は止める（superdough は無音でも発音ごとにノードを作るため）。
- イベント名・状態名は wavenerd-deck に合わせる：`changeCueStatus`、`error`、`'none' | 'compiling' | 'ready' | 'applying'`。

### 5. 初期化（`src/strudel/StrudelEngine.ts`）

- `setAudioContext(audio)` で、wavenerd と同じ AudioContext を使う。
- `evalScope(core, mini, tonal, webaudio)` を実行する。knob は評価ごとに注入する（6 章）。
- `prebake` と同じ音源をロードする（`src/strudel/prebake.ts`、strudel.cc から移植）。評価の準備（`ready`）はロード完了を待たない。シンセ、ZZFX、soundfonts、`strudel.b-cdn.net` の piano / VCSL / drum machines / Dirt-Samples 抜粋など。
- `repl.evaluate()` は evalScope のグローバルを書き換えるので、全デッキ共通の Promise キューで直列化する。
- 各 repl には異なる `id` を渡す。

### 6. knob（MIDI 連携）

- `knob0`〜`knob7` は、デッキごとの値ストアを読む `ref()` パターンとして提供する（Strudel の `slider` / `midin` と同じ仕組み）。値は 0〜1、未設定なら 0。
  - 例：`s("bd*4").lpf(knob0.range(200, 8000))`
- evalScope はグローバルなので、評価キューの中で `repl.evaluate()` の直前に、そのデッキの knob を `globalThis` に代入する。キューの外で代入すると、先に並んでいる他デッキの評価と入れ替わるおそれがある。
- `applyMidiParam` で `/deck_a/knobN` / `/deck_b/knobN` を受けたら、GLSL デッキに加えて同じスロットの `StrudelDeck.setParam()` も呼ぶ。モードに関係なく両方更新するので、起動時の MIDIMAN の値の再生で初期値も入り、モードを切り替えても knob の位置が揃う。
- 反映遅延は先読み分（約 0.1〜0.2 秒）。
- 制限：評価時ではなくクエリ時に `knob0` というグローバルを参照するコード（`.fmap(() => knob0 …)` の中や、別デッキで `register` した関数の中など）は、最後に評価したデッキの knob を読む。まれなので対処しない。必要になったら、ユーザーコードの先頭で knob を分割代入してレキシカルに束縛する方法がある（エラー位置がずれる・`knob0` の再宣言と衝突する、という欠点がある）。

### 7. UI

- デッキごとにモード切り替え（GLSL / Strudel）を置く。ステータスバーの `GLSL` / `Strudel` 表示をクリックして切り替える。モードは設定（`deckAMode` / `deckBMode`）に保存する。
- 各スロットで GLSL 用と Strudel 用の `Deck` を両方マウントしておき、表示だけ切り替える。再マウントすると未保存の編集が消え、コードも再適用されて音が飛ぶため。
- コードの保存先はモードごとに分ける：`decks/a.glsl` / `decks/a.strudel.js`、メモリは `memories/N.glsl` / `memories/strudel/N.js`。
- ~~Strudel モードではシェーダーライブラリ（`Mod-P`）を開かない。~~（2026-10-01 に変更）ライブラリ（`Mod-P`）はデッキのモードに合うものだけを出す。GLSL はアセット一覧の「Shaders」（`shaders/`）、Strudel は「Strudel」（`strudel/`）。名前を「Sketches」のような一般的なものにせず言語名にしたのは、今後ほかの言語を足したときにも 1 言語 1 カテゴリで並べられるようにするため。追加は Shaders と同じくファイルの読み込み（ドロップ / フォルダアイコン）だけで、エディタからの保存はない。
- モード切り替えは `GLSL | Strudel` の 2 分割トグルで、現在のモードを反転色で示す。色は既存のテーマトークン（`bar-fg` / `bar-bg`）のみ。
- Strudel モードのエディタ（`src/view/codemirror/strudel.ts`）
  - JavaScript 言語モード＋既存テーマ。
  - mini-notation のハイライト：`"…"` とバッククォート（`${}` の中は除く）の中身を、数値・`~`・語・演算子に分けてテーマの `constants` / `comments` / `strings` / `operators` の色で塗る。シングルクォートは mini-notation ではないので対象外。（2026-10-01 に廃止。REPL と同じく文字列全体を 1 色にした。「描画（widget）」を参照）
  - 補完：識別子は evalScope したモジュールのエクスポート＋`knob0`〜`knob7`、`.` の後は `Pattern.prototype` のメソッド、`s()` / `sound()`（メソッドも含む）の mini 文字列の中は superdough の `soundMap` のサウンド名（prebake の読み込みに追従するため毎回読む）。`javascriptLanguage.data` に登録するので、JS のローカル変数の補完も残る。
  - 言語拡張は `useMemo` で保持する。毎回作り直すと入力のたびにプラグインが再構成され、補完のポップアップが閉じる。
- エラー行：`src/view/utils/parseErrorLines.ts` でモードごとに解析する。GLSL は `ERROR: 0:N`、Strudel は構文エラー（acorn）の末尾 `(N:C)` と mini-notation の `at line N`。Strudel の mini-notation エラーは文字列内の行番号しか持たないので、`StrudelDeck` が各 mini 文字列を `mini2ast` で解析し直して、コード上の行に直したメッセージにする（元と同じエラー内容のものだけを採用するので、コメント内の壊れた文字列は無視される）。実行時エラー（`foo is not defined` など）は行が取れないので、ジャンプしない。
- ステータスバーの文言は GLSL では `shader`、Strudel では `pattern`。
- キー操作は GLSL デッキと共通。

### 8. ビルド・依存関係

モジュールが二重に読み込まれると、`setSuperdoughAudioController()` が別のインスタンスのシングルトンを書き換えることになる。その場合、音がミキサーを通らずに `ctx.destination` に直接流れる（v1 と同じ失敗）。pnpm は依存の配置が厳格なので、特に注意する。

- `@strudel/*` と `superdough` は、すべて同じ**完全一致バージョン**に固定する。
- `superdough`・`@strudel/core`・`nanostores` は直接の依存として追加する。`resolve.dedupe` が効くのは、プロジェクトのルートから解決できるパッケージだけのため。
- Vite では `resolve.dedupe: ['superdough', 'nanostores', '@strudel/core', '@codemirror/state', '@codemirror/view']` を設定する。
- 受け入れ条件：`pnpm why superdough` と `pnpm why @strudel/core` の結果が、それぞれ 1 バージョンだけであること。
- superdough の worklet は dist にインライン済み（data URL）なので、Vite プラグインは不要。

## マイルストーン

1. **M0 スパイク**：ブラウザで次の 3 点を確認する。
   - `DeckOutputController` によるルーティング
   - AudioContext 時刻の対応（GLSL の小節頭と Strudel の cycle 頭が揃うか）
   - 2 つの repl の同時動作
2. **M1 音の経路＋最低限の UI**：ライセンス変更、`StrudelEngine`、`DeckSourceSwitch`、`StrudelDeck`。M0 で `StrudelScheduler` が動いたので Cyclist は経由せず、M2 の同期と cue（`Mod-S` / `Mod-R` / `Shift-Mod-R`）もここで入れる。試せるように M4 のモード切り替えとモードごとのコード保存も前倒しした。
3. ~~**M2 同期と cue**~~：M1 に統合。
4. **M3 knob**：`knob0`〜`knob7` と MIDI 連携。
5. **M4 UI の仕上げ**：切り替え UI の見た目、Strudel 用のエディタ補完・ハイライトなど。

後回しにしていたもの（パターンのハイライト、ストレージのサンプル、widget、Strudel 用エディタテーマ）はすべて実装済み（「パターンのハイライト」「ストレージのサンプル」「描画（widget）」を参照）。エディタテーマは REPL の標準テーマに固定し、テーマの選択はできない（「描画（widget）」の「仕組み」を参照）。

## M0 スパイク結果（2026-09-30）

コード：`src/strudel/`（`DeckOutputController` / `DeckClock` / `StrudelScheduler` は M1 以降でも使う）。スパイク本体は M1 で削除した。計測用のプローブは `src/strudel/dev/` に移し、`?strudelDev` を付けて起動すると `window.strudelDev` から使える。

| 確認項目 | 結果 |
|---|---|
| モジュールの同一性 | `superdough` と `@strudel/webaudio` の `setSuperdoughAudioController` / `getAudioContext` が同一。dev と `pnpm build` の両方で確認 |
| ルーティング | 発音後もデフォルト controller の orbit 数は 0。A / B の controller にだけ orbit ができる |
| タイミング | GLSL の小節頭と Strudel の cycle 頭の差は **+0.49ms（揺れ ±0.02ms）**。140→173 BPM の変更、pause/再開、rewind の後もずれない |
| 2 つの repl | 評価を同時に投げても直列化され、`$:` のスタックはデッキごとに独立。音も各デッキの出力ノードにだけ出る |

測定方法：GLSL デッキ A で小節頭にクリック、Strudel A で毎 cycle に square を鳴らし、両者の出力を AudioWorklet で比較して立ち上がりのフレームを記録した。

分かったこと：
- `DeckClock` は hostDeck の BeatManager の `update` イベント（`time` / `sixteenBar` / `bpm`）と `blockOffset` から時刻を求める。deckB も hostDeck の BeatManager を自分の書き込み位置で更新するので、イベントが少し戻ることがある。16 小節の位相を「最も近い表現」で展開して吸収している。
- `initAudio()` は使わず、`loadWorklets()` を直接呼ぶ。
- 開発時の注意：Claude Code のサンドボックスではポートの bind と pnpm のグローバルストアへの書き込みが禁止されているため、`pnpm dev` / `pnpm add` はサンドボックス外で実行する。

耳での確認：ミキサーのチャンネル音量を 0 にすると Strudel の音は消える（ユーザー確認済み）。

## M1 結果（2026-09-30）

実際の経路（`StrudelDeck` → `DeckSourceSwitch` → ミキサー）で `?strudelDev` を使って確認した。

| 確認項目 | 結果 |
|---|---|
| タイミング | GLSL デッキ A のクリックと Strudel デッキ B のクリックの差は +0.49ms（M0 と同じ） |
| `Mod-R` | 新しいパターンは次の cycle 境界（整数）からちょうど始まる |
| `applying` 中の再コンパイル | 差し替え時点で最新のパターンが反映される |
| UI の往復 | Strudel モードで編集 → `Mod-S` → メモリ保存（`Shift-Mod-1`）→ リロード：モード・コードが復元され、GLSL 側のコードは変わらない。`Mod-1` で Strudel のメモリが戻る。読み込み後のコンソールエラーなし |
| `Shift-Mod-R` / rewind | 即時に反映される。rewind 後は cycle 0 から始まる |
| エラー | 構文エラー・実行時エラーは `error` に出て状態は `none`。成功時に `error: null` でクリアされる |
| モード切り替え | ステータスバーから切り替えられる。Strudel 側のスケジューラは Strudel モードの間だけ動く |

分かったこと・残課題：
- `applyCue` 後に状態が `none` に戻るのは、実際に鳴る瞬間ではなく発音予定を出した瞬間（先読み分の約 0.1〜0.2 秒早い）。
- Strudel コード内の `setcps` / `setcpm` は効かない（テンポは BeatManager に従うため）。`cpm()` は repl 内部の Cyclist の cps（0.5）を基準に計算するので、1 小節 = 1 cycle とずれる可能性がある。
- tr909 などのサンプルはピークが 1.0 を超えることがある。音量はミキサーのゲインで調整する。

## M3 結果（2026-09-30）

| 確認項目 | 結果 |
|---|---|
| デッキ間の分離 | `strudelDev.knobCheck()`：同じコード `s("bd*4").lpf(knob0.range(200, 8000))` を A / B で同時にコンパイルし、A の knob0=1・B の knob0=0 で A は 8000、B は 200。A だけ 0.5 にすると A は 4100、B は 200 のまま |
| 初期値 | リロード後、MIDIMAN に保存されている `/deck_a/knob0` の値が Strudel デッキ A にも入る |

## M4 結果（2026-09-30）

| 確認項目 | 結果 |
|---|---|
| エラー | `s("bd").lpf(` → `Unexpected token (1:12)`。3 行目の `.n("0 [1")` → `[mini] parse error at line 3: …`。`foo123()` → `foo123 is not defined`（行なし）。GLSL は従来どおり `ERROR: 0:2: …` |
| エラー行の UI | mini-notation のエラーで 3 行目に下線が出て、ステータスバーのクリックで 3 行目に移動する。実行時エラーはクリックできない表示になる |
| 補完 | `s("sawt` / `.s("sawt` → `sawtooth` など（`note("c` では出ない）、`.lp` → `lp` / `lpattack` / …、`kno` → `knob0`〜`knob7`。入力を続けてもポップアップは閉じない |
| ハイライト | mini 文字列の演算子・数値・語が色分けされる |

## バックグラウンドタブ対応（2026-09-30）

Chrome は、タブが裏にあり、かつ無音が約 30 秒続くと、メインスレッドのタイマーを 1 秒に 1 回へ間引く（音が鳴っている間は間引かれない）。GLSL デッキの更新ループ（`src/index.tsx` の `updateAudio()`、setTimeout）と `StrudelScheduler`（setInterval 50ms）が同時に止まり、両デッキで毎秒アンダーランが出た。

計測条件：Chrome、44.1kHz、タブは裏、デッキ A は GLSL、デッキ B は Strudel。

| 状況 | デッキ更新とスケジューラ tick の 1000ms 級の空き | アンダーラン |
|---|---|---|
| 対処前・発音中（30 秒） | なし | なし |
| 対処前・無音（約 31 秒以降） | 毎秒 | 両デッキで毎秒 |
| 対処後・裏かつ無音（80 秒） | なし | なし |
| 対処後・裏かつ無音（約 6 分） | デッキ更新に 254ms の空きが 1 回 | 両デッキで 1 回ずつ |
| 対処後・6 分の無音のあと裏のまま発音（16 秒） | なし | なし |

- 対処前は、音が戻ると 1000ms の空きが 1 回出たあとタイマーが回復した。
- 対処後の計測中、素の 50ms setInterval は 1000ms 間隔になっていた（間引きが効いている状態）。
- 対処後の無音中、スケジューラの tick は約 81ms 間隔になる（`poke()` のしきい値 75ms + tick の粒度 約 12ms）。先読み 0.2 秒の範囲内。
- 6 分の計測で 1 回出た 254ms の空きは、計測用のスクリプトを実行した直前に起きた。計測自体が原因の可能性があるが、切り分けていない。
- 6 分の無音のあとに音を戻したとき、GLSL の小節頭と Strudel の cycle 頭の差は +0.50ms（10 回、+0.48〜+0.50ms）で、M0 の結果と同じ。

仕組み：
- `TickNode`（`src/audio/TickNode.ts` / `TickProcessor.js`）：AudioWorklet がオーディオスレッドから 4 ブロックごと（44.1kHz で約 12ms）にメッセージを送る。
- `src/index.tsx` は tick のたびに `updateAudio()` と `strudelDeckA.poke()` / `strudelDeckB.poke()` を呼ぶ。`updateAudio()` は自分自身と重ならないようにガードした。
- `StrudelScheduler.poke()` は、自分のタイマーが遅れているとき（間隔の 1.5 倍超）だけ tick する。タブが見えているときの動作は変わらない。
- 従来のタイマーはフォールバックとして残す（AudioContext の開始前はこちらが動く）。

対象ブラウザは Chrome とする（2026-09-30 決定）。Safari と Firefox は計測しない。

未確認：最小化したウィンドウ、6 分を超える無音、Chrome のメモリセーバーなどによるタブの凍結。

## 裏で動く GLSL デッキの負荷（2026-09-30）

当初は、Strudel モードのスロットでも GLSL デッキが裏で描画と読み出しを続けていた（出力は `DeckSourceSwitch` でミュート）。そのコストを `strudelDev.loadCheck()` で計測した。

計測条件：Chrome、Apple M2 Max、48kHz、スロット A は GLSL（軽いキック）、スロット B は Strudel（`s("bd*4, hh*8")`）。裏のデッキ B の GLSL コードだけを変えた。タブは裏（`visibilityState` は `hidden`）だったので、ビジュアライザーの描画は止まっている。各条件 8〜10 秒。

1 回の描画は 2048 フレーム（42.67ms 分の音）で、`update()` がこれより長くかかると間に合わない。

| 裏のデッキ B のコード | B の `update()` p50 / p95 (ms) | A の `update()` p50 / p95 (ms) | アンダーラン A / B |
|---|---|---|---|
| 保存されていたコード | 4.4 / 5.1 | 4.6 / 5.2 | 0 / 0 |
| 無音（`return vec2(0.0)`） | 4.5 / 5.4 | 4.6 / 5.5 | 0 / 0 |
| サイン波 1,000 個の加算 | 5.3 / 6.5 | 4.6 / 6.0 | 0 / 0 |
| サイン波 10,000 個 | 18.0 / 23.5 | 4.6 / 22.3 | 0 / 0 |
| サイン波 30,000 個 | 23.0 / 26.9 | 4.6 / 23.7 | 0 / 0 |
| サイン波 60,000 個 | 41.6 / 43.6 | 5.0 / 42.8 | 0 / 0 |
| サイン波 100,000 個 | 66.2 / 74.9 | 4.4 / 66.4 | 41 / 115 |

- 固定費は 1 回あたり約 4.4ms（描画 1 回分の時間の約 10%）。無音のシェーダーでも変わらないので、シェーダーの計算ではなく、描画・読み出し・ワーカーとのやり取りにかかる時間。
- サンプルあたりサイン波 1,000 個でも +0.8ms しか増えない。普通のシェーダーなら、裏に残っていても問題にならない。
- 60,000 個で `update()` が描画 1 回分の時間とほぼ並び、100,000 個で間に合わなくなる。このとき、聞こえているデッキ A でもアンダーランが出る。原因は 2 つある。
  - `updateAudio()` が両デッキの `update()` を `Promise.all` で待つので、片方が遅いともう片方の次の更新も遅れる。
  - 2 台のワーカーは同じ GPU を使うので、A の読み出しが B の描画の後ろで待たされる。A の `update()` は p50 が変わらないまま、p95 だけが B の p50 近くまで伸びている。このため、両デッキの更新を切り離すだけでは A を守りきれない。
- どの条件でも、Strudel のスケジューラの tick 間隔は最大 58ms（設定は 50ms）で、メインスレッドの long task は 0 件だった。
- GPU 使用率そのものはページから取れないので測っていない。

上の表は対処前の計測。普通のシェーダーなら問題にならない負荷だが、Strudel モードに切り替えたスロットでは GLSL デッキの処理を行わないのが妥当なので、描画を止めることにした（2026-09-30 決定）。

### 対処：DeckRenderGate

`src/audio/DeckRenderGate.ts` が、Strudel モードのスロットの GLSL デッキの描画と読み出しを止める。

- `WavenerdDeck.update()` は止めない。`update()` が `beatManager.update()` を呼んで Strudel のクロック（`DeckClock`）を進めているため。
- デッキのレンダラー（private の `__renderer`）の `render()` と `readBuffer()` を包む。止めている間は、描画を飛ばし、読み出しの代わりに無音のバッファを返す。デッキは無音を書き込み続けるので、書き込み位置もクロックもそのまま進み、アンダーランも出ない。
- `@0b5vr/wavenerd-deck` へのパッチは使わない。レンダラーが見つからないときは何もせず、従来どおり描画が続く（警告を出す）。
- コンパイルと cue は止めないので、GLSL デッキで適用中のコードは残る。

Strudel から GLSL に戻すとき：デッキには無音が先行して書き込まれている（`latencyBlocks` 分、既定で約 85ms）。すぐに切り替えると、その間だけ音が途切れる。そこで、描画を再開したあと最初のチャンクが鳴る時刻を `DeckRenderGate.enable()` のコールバックで受け取り、その時刻に `DeckSourceSwitch.setMode('glsl', time)` でクロスフェードし、Strudel のスケジューラを止める。それまでは Strudel が鳴り続ける。停止中のデッキでは待つものがないので、すぐに切り替える。

対処後の計測（条件は上と同じ。モードは UI のトグルで切り替えた）：

| 状況 | 止めたデッキの `update()` p50 / p95 (ms) | 鳴っている GLSL デッキの `update()` p50 / p95 (ms) | アンダーラン A / B |
|---|---|---|---|
| B が Strudel、裏のデッキ B はサイン波 100,000 個 | 0.2 / 0.4 | 4.7 / 5.5 | 0 / 0 |
| A が Strudel（クロックを持つホストデッキを止める）、B が GLSL | 0.3 / 0.4 | 4.6 / 5.6 | 0 / 0 |
| A も B も Strudel | 0.3 / 0.4（A）、0.1 / 0.3（B） | — | 0 / 0 |

- ホストデッキを止めた状態で、GLSL（デッキ B）の小節頭と Strudel（デッキ A）の cycle 頭の差は +0.79ms（7 回、+0.77〜+0.79ms）。M0 の +0.49ms とはクリックの音量が違うので値は比べられないが、ずれは一定で、クロックは揃っている。
- 両方 Strudel のとき、8.01 秒の間に BeatManager の時刻は 8.02 秒進んだ。
- Strudel → GLSL の切り替えで、スロットの出力に無音の区間は出なかった（2 回、256 サンプル単位のピークで確認）。
- GLSL → Strudel では、切り替えた時点より後に始まる音からしか鳴らない（1 cycle に 1 音のパターンで 587ms の無音が 1 回出た）。スケジューラを GLSL モード中は止めているためで、この対処より前からの挙動。
- 停止中に Strudel → GLSL へ切り替えると、すぐに切り替わり、再生すると GLSL の音が出た。
- GLSL デッキにプログラムがない（一度もコンパイルに成功していない）状態でも、Strudel → GLSL は 100〜150ms 以内に切り替わった。このデッキは描画をしないので、描画ではなく最初の書き込みを合図にしている。

未確認：タブが表にある状態（ビジュアライザーが GPU を使っている状態）での同じ計測。

## パターンのハイライト（2026-10-01）

いま鳴っている mini-notation の要素（`bd`、`c2` など）を、Strudel モードのエディタ上で枠線で囲む。strudel.cc の REPL と同じ見え方。

### 仕組み

- 位置の情報は Strudel が持っている。transpiler が mini 文字列の各要素のコード上の位置（`miniLocations`）を返し、hap は自分の元になった要素の位置を `hap.context.locations` に持つ。`.s("sawtooth")` のように複数の文字列から作られた hap は、位置を複数持つ。
- `StrudelDeck`
  - コンパイルに成功するたびに、コード・位置・連番の id を `compiledCode` に置く（`repl` の `afterEval` で受け取る）。
  - 鳴っているコードの id は `activeCodeId`。cue を反映した時点で切り替わる。
  - 発音を予約するとき（`onTrigger`）に、その hap が鳴る区間（AudioContext 時刻）と位置を記録する。`collectSoundingLocations()` が、現在時刻に鳴っているものを返す。現在時刻は `currentTime - outputLatency`。
  - 一時停止・巻き戻し・GLSL モードへの切り替えで、記録を捨てる（予約済みの音も同時に切っているため）。
- エディタ（`src/view/codemirror/strudelHighlight.ts`）
  - フレームごと（`FrameEmitter`）にデッキを見る。鳴っている要素の組が変わったときだけ、エディタを更新する。
  - コンパイルしたコードの各要素の位置を、エディタ内の範囲として持つ。範囲は編集に追従するので、鳴っているコードを書き換えている途中でも、枠線は正しい場所に出る。
  - 持つのは「鳴っているコード」と「最後にコンパイルしたコード」の 2 つ分だけ。
  - 位置はコンパイルした時点のコードのものなので、エディタの内容がそのコードと一致したときに登録する。起動時は、コードの読み込みとコンパイルがほぼ同時に起きるため、エディタに反映されるまで待つ。
- 枠線の色は、テーマの文字色（`text`）。

### 確認結果（Chrome）

デッキ B で `note("<c2 eb2 g1 bb1>*8").s("sawtooth")` を再生した。計測用のタブは裏にあり `requestAnimationFrame` が動かないので、`strudelDev.frameEmitter` からフレームを手動で発行した。

| 項目 | 結果 |
| --- | --- |
| 位置 | `miniLocations` はエディタ上の文字位置と一致した |
| 再生中 | `c2` → `eb2` → `g1` → `bb1` の順に枠線が移る。`8` と `sawtooth` は常に囲まれる |
| 先頭に行を挿入 | 枠線は移動後の要素に付いたまま |
| `bb1` を `a1` に書き換え（コンパイルなし） | 鳴っているのは `bb1` のままだが、書き換えた `a1` が囲まれる |
| コンパイルして `Mod-R` 相当（`applyCue`） | 次の小節から新しいコードの要素が囲まれる |
| 一時停止 | 枠線はすぐ消える |
| 巻き戻し | 枠線はすぐ消え、先頭の `c2` から出直す |
| Strudel → GLSL → Strudel | GLSL に切り替わると消え、Strudel に戻すとまた出る |
| 先頭に日本語と絵文字のコメント行を置いてコンパイル | 位置はずれない |

未確認：タブが表にある状態での見え方（音とのずれの体感）。

### 制限

- コンパイル中（評価が終わるまでの間）にエディタを編集すると、そのコードの位置は登録されず、次にコンパイルするまで枠線が出ない。
- mini 文字列の要素だけが対象。`note(60)` のように文字列を使わない部分は囲まれない。
- hap の色（`.color()`）は使わない。

## ストレージのサンプル（2026-10-01）

アセット一覧に取り込んだサンプル（OPFS の `samples/`）を、Strudel のパターンから `s("kick")` のように鳴らせる。CDN を通らないので、回線がなくても鳴る。

### 仕組み

- `src/strudel/UserSamples.ts`（`StrudelEngine.userSamples`）。`src/index.tsx` のストレージの処理が、GLSL デッキの `loadSample` / `deleteSample` と並べて `set` / `delete` を呼ぶ。起動時、取り込み時、削除時に反映される。
- 名前は GLSL デッキと同じ（`pathToAssetName`。拡張子を取り、英数字と `_` 以外を `_` にする）。ただし superdough が小文字にそろえるので、`Kick.wav` は `s("kick")` になる。`s("Kick")` と書いても鳴る。
- 1 ファイル = 1 つの音。`kick:1` のような番号違いは作らない（`n` は無視され、同じファイルが鳴る）。
- 登録には `registerSound` と `onTriggerSample` を直接使う。`samples()` は `wt_` で始まる名前をウェーブテーブルにしてしまうため。
- superdough は音声を URL ごとにキャッシュし続けるので、内容ごとに blob URL を作る。登録と同時にデコードしておき（`loadBuffer`）、最初の 1 発が落ちないようにする。デコード後に blob URL は破棄する。
- デコードできないファイルは登録を取り消し、コンソールに警告を出す。`failedSounds`（CDN の失敗）には入れない。

### 名前が標準の音と重なったとき

方針（ユーザー決定）：ストレージのサンプルを優先する。`bd.wav` を取り込むと、`s("bd")` はそのファイルを鳴らす。

- CDN の音は起動時と回線の復帰時に登録されるので、読み込みの順番に頼れない。`soundMap` の変更を監視し、上書きされたらその場で取り返す。
- 隠した標準の音は覚えておき、サンプルを削除したら戻す。

### 確認結果（Chrome、`strudelDev.strudelDeckA.engine.userSamples`）

AudioContext を止めたまま（無音で）、生成した WAV を登録し、`onTrigger` が返すバッファの長さで確かめた。

| 項目 | 結果 |
| --- | --- |
| 登録 | `ZZ_Claude_Test` が `zz_claude_test` として登録され、0.1 秒のバッファが返った |
| 上書き | 0.2 秒のファイルで上書きすると、リロードなしで 0.2 秒のバッファが返った |
| 衝突 | `bd` を登録すると自前の音になり、削除すると元の `bd` に戻った。登録後に `samples()` で `bd` を登録し直しても自前の音のまま |
| 削除 | `soundMap` から消えた。大文字小文字が違う名前（`zz_claude_test`）での削除は無視された |
| 壊れたファイル | 登録が取り消された |
| `wt_` で始まる名前 | ウェーブテーブルではなくサンプルとして登録された（発音は未確認） |
| 数字だけの名前（`808`） | `s("808")` でバッファが返った |
| 起動時の読み込み＋オフライン | OPFS に `samples/ZZ Claude-Test.wav` を置き、`?strudelDev&strudelOffline` で起動。CDN の 6 本が失敗した状態でも登録されていて、`s("ZZ_Claude_Test*4")` がコンパイルできた |

未確認：実際に音を出しての再生、アセット一覧の UI からの取り込みと削除（`save` / `delete` イベント経由）。

### 制限

- 上書きや削除をしても、デコード済みの音声は superdough のキャッシュに残る（外からは消せない）。リロードで解放される。
- `Kick.wav` と `kick.wav`、`kick.wav` と `kick.mp3` は同じ名前になり、後から読み込まれたほうが鳴る。
- ストレージのウェーブテーブル（`wavetables/`）は対象外。

## 描画（widget）（2026-10-01）

`._pianoroll()` などのインライン widget と、`.pianoroll()` などの背景描画に対応した。対象は `pianoroll` / `punchcard`（`wordfall` を含む）/ `spiral` / `scope`（`tscope`）/ `fscope` / `spectrum` / `pitchwheel`。インライン版は `_pianoroll` / `_punchcard` / `_spiral` / `_scope` / `_spectrum` / `_pitchwheel` の 6 つで、REPL と同じ。

### 仕組み

- Strudel 本来の描画は、グローバルな `getTime()`（1 つの REPL の時計）と全画面の `#test-canvas` を使う。2 デッキでは正しく動かないので、描画メソッドを `Pattern.prototype` ごと差し替えた（`src/strudel/StrudelVisuals.ts`、`StrudelEngine` の初期化時に登録）。インライン版は `@strudel/codemirror` の代わりに、transpiler の `registerWidgetType` で登録する。
- 評価中に呼ばれた描画メソッドは、そのデッキの `StrudelVisual`（種類・呼ばれたパターン・オプション）として集める。評価は直列なので、集める先はモジュール変数 1 つで足りる。インライン版の位置は、transpiler の `meta.widgets` の `to` から取る。
- 描画は `cue` と同じ単位で切り替わる。`StrudelCompiledCode.visuals` → `staged` → 反映時に `StrudelDeck.activeVisuals`。つまり、表示されるのは鳴っているコードの描画で、ハイライトと同じフレームに切り替わる。
- 時刻は `DeckClock` の cycle（`audio.currentTime - outputLatency`、ハイライトと同じ）。停止中は最後の位置で止まる（`DeckClock.displayCycleAt`）。毎フレーム、パターンを描画範囲で `queryArc` し、`@strudel/draw` の描画関数（`__pianoroll`、`pitchwheel`、punchcard / spiral の painter）や `@strudel/webaudio` の `drawTimeScope` / `drawFrequencyScope` で描く。`drawSpectrum` は export されていないので写した。
- scope 系は `pattern.analyze(id)` を返し、superdough の analyser（id ごとのグローバル）に音を流す。id はデッキごとに違う（インライン：`deckA_widget__scope_0`、背景：`deckA_scope_0`）。
- エディタ（`src/view/codemirror/strudelWidgets.ts`）：インライン描画は、呼び出し行の下のブロック widget（canvas）。位置はハイライトと同じく、コンパイル時のテキストと一致したときに登録し、編集に追従させる。widget id が同じなら再コンパイル後も canvas を使い回す。
- 背景（`src/view/components/StrudelDeckBackground.tsx`）：デッキのコードの裏に、描画ごとの canvas をコード順に重ねる。REPL と違い全画面ではなくデッキ単位。不透明度は 80%（REPL は 100%）。様子見中の値。
- `.draw(fn, { lookbehind, lookahead })`（2026-10-01 追加）：これも差し替えた。元の実装は呼ばれた時点で `getTime()` を読んでクエリするが、cue があるのでその時点はコンパイル時になってしまう。差し替え後は、反映後の最初のフレームから、デッキの cycle で `fn(haps, time, time + lookahead, pattern)` を毎フレーム呼ぶ。hap の溜め方（onset のある hap、1 フレームで遡るのは最大 0.1 cycle、`lookbehind` より古いものは捨てる）は元と同じ。cycle が戻ったら（rewind）溜めた hap を捨てる。`options` は省略してよい（元は省略すると例外になる）。
- `getDrawContext(id, options)`：`evalScope` の後でグローバルを差し替えた（`getStrudelDrawContext`）。canvas は「コンパイルしたコード」ごとに id 別に作る。評価中に呼ばれたら評価中のコードの canvas、`.draw` の callback 中ならそのコードの canvas を返す。callback 中を優先する（`await samples(…)` などで評価が長引く間も、他のコードのフレームは動くため）。2 デッキが同じ id（既定の `test-canvas`）を使っても別の canvas になる。どのコードにも属さない呼び出しには、表示されない canvas を返す。canvas は `staged` → 反映で `StrudelDeck.activeDrawCanvases` に入り、次のコードの反映で消える（REPL の評価ごとのクリアに相当）。コンパイルしただけでは鳴っているコードの canvas に触らない。背景では、これらの canvas を `.pianoroll()` などの canvas より下に重ねる。`pixelated` / `pixelRatio` / `contextType` の各オプションは canvas に渡すが、動作は未確認。
- 色はアプリのテーマ（`--color-fore` / `--color-foresub`）を `@strudel/draw` の `setTheme` に渡す。
- Strudel デッキは、アプリのテーマによらず REPL の標準テーマ `strudelTheme`（`@strudel/codemirror` 1.2.6）の配色にした（`src/view/codemirror/strudelTheme.ts`）。デッキの背景 `#222222`、構文色、描画の色（`foreground` `#ffffff`）が REPL と同じ。パネルや補完などのテーマにない部分は wavenerd の構造に `strudelTheme` の色を入れた。背景描画の上でも読めるよう、REPL と同じくトークンの後ろに `lineBackground`（`#22222299`、strudel.cc の CSS の `.cm-line > *`）を敷き、現在行は `lineHighlight`（`#00000050`）で暗くする。GLSL デッキは変えない。mini-notation の中の色分け（M4）もやめ、REPL と同じく文字列全体を緑 1 色にした。

### 確認結果（Chrome、AudioContext 停止中に `frameEmitter.__emit('update', …)` で手動でフレームを進めて確認）

- インラインの `_pianoroll` / `_scope` / `_spiral` / `_pitchwheel` / `_punchcard` と、背景の `.pianoroll()` が、どれも空でない canvas に描かれる。`#test-canvas` は作られない
- `_scope` の analyser は `deckA_widget__scope_0` で作られ、波形が描かれる
- 上に 2 行挿入すると、widget も 2 行下にずれる
- compile しただけでは描画は変わらず、反映で新しいコードの描画に変わる。背景の canvas も消える
- 停止中も例外を出さない

`.draw()`（2026-10-01、同じ方法で確認）：

- `s("bd sd").draw(fn, { lookahead: 1 })` で `fn` が呼ばれ、`getDrawContext()` の canvas がデッキの大きさになり、描いた色が読める。`#test-canvas` は作られない
- デッキ A / B が既定の id で `getDrawContext()` を使うと、別々の canvas に描かれる
- 新しいコードをコンパイルしただけでは、鳴っているコードの canvas は変わらない。反映すると canvas が入れ替わる
- 溜めた hap は、cycle が戻ると捨てられる。止まっている間は増えない
- `.draw(fn)`（options なし）が動く
- GLSL → Strudel の切り替え後も描かれる（Strudel → GLSL → Strudel は未確認）
- 片方のデッキが評価中（`await` で 300ms 止まる）にフレームを進めても、鳴っているコードの callback は自分の canvas に描き続け、評価中のコードには canvas が増えない（A の評価中も、B 自身の評価中も）

未確認：`_spectrum`、`.fscope()`（analyser がないときの経路を含む）、背景の `.scope()` / `.spiral()` / `.punchcard()` / `wordfall`、`all(pianoroll)`、次の小節での反映（`applyCue`）、デッキ B、見えているタブで音と同期して動くか。

### 制限

- `.animate()` には対応しない（2026-10-01 に決定）。Strudel 側でも音との同期のコードがコメントアウトされていて未完成なため。`@strudel/draw` の中で元の `getDrawContext` を直接使うので、呼ぶと従来どおり全画面の canvas に描き、正しく動かない。`cleanupDraw` も同じ。
- `getDrawContext()` の canvas は、画面に置かれるまで大きさが決まらない。コードの最上位で描いたもの（例：`getDrawContext().fillRect(…)`）は、反映して画面に置いたときの大きさ合わせで消える。`.draw` の callback の中で描けば残る。callback の中で新しい id の canvas を作ったときも、最初の 1 フレームは同じ理由で消える。
- ~~評価中の漏れ~~：評価は `await` の間も続くので、その間に他のデッキのスケジューラがクエリして描画メソッドが呼ばれる（`every(cat(1, 2), x => x.pianoroll())` のように、引数がパターンでクエリ時に関数が呼ばれる形）と、評価中のデッキの描画として集められていた。直した（2026-10-01）：こちらのクエリ（スケジューラと描画のフレーム処理）は `src/strudel/patternQuery.ts` の `queryPattern()` を通し、その間は描画を集めない。確認（Chrome、無音）：素の `queryArc` では 1 件集まり、`queryPattern` では 0 件。50ms 止まる評価の途中に `queryPattern` を挟んでも漏れず、評価時に呼んだ `.pianoroll()` は従来どおり集まる。
- `.onPaint(painter)` には対応しない（2026-10-01 に決定）。REPL では Drawer が毎フレーム呼ぶ低レベルの口で、本家の `.punchcard()` / `.spiral()` / `.pitchwheel()` はこれを使って作られているが、ここではそれらを差し替えているので組み込みの描画には要らない。直接書くのは自前の canvas 描画を書くときだけなので見送った。呼んでもエラーにはならず、何も描かれない。
- `every(…, x => x._pianoroll())` のように、クエリ時にだけ呼ばれる描画は表示されない（パターンとしては動く）。
- `slider()` には対応していない（knob と MIDI を使う）。

## 未決事項・リスク

- ~~**タブが裏にあるとき**~~：計測して対処済み。タイマーが間引かれるのは、タブが裏にあり、かつ無音が約 30 秒続いたときだけ。AudioWorklet（`TickNode`）からの tick で解決した。対象は Chrome。最小化したウィンドウは未確認。
- ~~**Strudel モード中のクロック**~~：BeatManager はデッキの `update()` が再生中に呼ばれている間しか進まないので、Strudel モードでも GLSL デッキの `update()` は続ける。描画と読み出しは `DeckRenderGate` で止める（「裏で動く GLSL デッキの負荷」を参照）。
- **wavenerd-deck の内部構造への依存**：`DeckRenderGate` は `WavenerdDeck` の private な `__renderer` の `render()` / `readBuffer()` を包む（0.9.0 で確認）。`update()` が書き込み位置を進める前に `readBuffer()` を呼ぶことにも依存している。更新で内部が変わると、描画が止まらなくなるか、GLSL へ戻すタイミングがずれる。
- **superdough の更新**：ルーティングの回避策は superdough 1.3.0 の内部構造に依存している（M0 で動作確認済み）。更新で内部が変わると壊れるので、バージョンを固定する。
- ~~**遅延の差**~~：M0 で確認済み（差は +0.49ms）。
- **外部 CDN への依存**：音源は `strudel.b-cdn.net` と `felixroos.github.io` から取得する。方針は「CDN を標準とし、完全オフラインでの動作は将来のオプション」（下の「オフライン時の挙動」を参照）。

## オフライン時の挙動

方針（ユーザー決定）：音源は CDN から取るのを標準とする。完全オフラインで演奏できるようにするのは必須ではなく、将来、起動時のオプションなどで対応する。運用は手元の localhost。

### 仕組み（superdough 1.3.0。ソースを読み、`?strudelDev&strudelOffline` で確認した）

- 起動時に取るのはサンプル一覧の JSON だけ。音声ファイルは、その音を最初に鳴らすときに取る。`n` やノートが違えば別のファイルになる。
- 一度鳴らした音はメモリにあるので、回線が落ちても鳴り続ける。リロードすると消える。
- 音声ファイルの取得に失敗すると、失敗した Promise がキャッシュされ、回線が戻ってもリロードまで鳴らない（サンプル、ウェーブテーブル、サウンドフォントとも）。パッケージの外からは消せないので、パッチで直した（下の「対処したこと」）。
- 発音時のエラーは superdough が受け止めてログに流すだけで、デッキのエラー表示には届かない。同じメッセージは 1 秒間まとめられる。`document` の `strudel.log` イベントで拾えるが、どのデッキの音かは分からない。
- シンセと ZZFX はネットワークを使わない。

### 対処したこと

- 音源のソースを 1 つずつ読み込み、1 つ失敗しても他を止めない（`src/strudel/prebake.ts`）。以前は JSON が 1 つ落ちるとドラムマシンの別名（`bank("tr909")` など）が登録されなかった。
- 失敗したソースの名前を `StrudelEngine.failedSounds` に持ち、Strudel モードのステータスバーにアイコンで出す。
- ブラウザの `online` イベントで、失敗したソースだけを読み込み直す。
- 演奏中に音声ファイルの取得に失敗した音を `StrudelEngine.failedFiles` に持ち、同じアイコンで出す（ツールチップは「一覧の失敗」と「演奏中の失敗」に分ける）。`StrudelDeck` の出力で `superdough()` の失敗を受け取り、`bd:5` や `tr909_bd` のようにコードに書いた名前で記録する。`strudel.log` のメッセージには音の名前が入らないので使わない。
  - 対象は `TypeError: Failed to fetch`（回線断）と `EncodingError`（エラーページなど音声でないファイル）。その音が次に鳴ったときに一覧から外す。
  - `sound ... not found` は数えない。一覧の失敗（既存の表示）か、名前の打ち間違いのどちらかなので。
  - 同じ名前は 1 回だけ記録し、イベントも 1 回だけ出す。
- 失敗した音声ファイルは、失敗から 5 秒たった後の発音で取得し直す（`patches/superdough@1.3.0.patch` と `patches/@strudel__soundfonts@1.3.0.patch`）。対象はサンプラーとウェーブテーブル（superdough）、サウンドフォントのプリセットと音程ごとのバッファ（`@strudel/soundfonts`）のキャッシュ。
  - 失敗した時刻を覚え、次に引くときに 5 秒過ぎていればキャッシュから消す。タイマーは使わない（裏のタブで間引かれるため）。
  - 待つのは、オフライン中や 404 のファイルで、ハップのたびに取得しに行かないため。取得は 1 ファイルにつき 5 秒に 1 回まで。
  - 実際に動くのは minify された `dist/index.mjs`。ソースの `.mjs` にも同じ変更を入れてある。
  - サウンドフォントは音程ごとにキャッシュされるので、ある音程が鳴って一覧から消えても、別の音程はまだ失敗していることがある。

### 確認結果（2026-09-30、Chrome）

オフライン状態で起動し、`s("bd")`、`s("casio")`、`gm_piano`、`sawtooth`、`s("bd").bank("tr909")` を重ねて再生した。

| 項目 | 結果 |
| --- | --- |
| 起動直後 | サンプル一覧 6 本と別名が失敗し、ステータスバーにアイコンが出た。コンパイルと再生はできた |
| オフラインで再生 | `bd` と `tr909_bd` は `sound ... not found`、`casio`（一覧がコードに埋め込み）と `gm_piano` は `Failed to fetch`。デッキのエラー表示には出ない |
| 復帰して `retryFailedSounds()` | 失敗は 0 件になり、アイコンが消えた。`bd` と `tr909_bd` は再コンパイルなしで読み込まれた |
| 復帰後の `casio` / `gm_piano` | `Failed to fetch` のまま。取得し直しにも行かない |

未確認：実際に回線を切ったときの `online` イベント経由の再読み込み（スイッチはイベントを出さないため、手動で呼んだ）。

演奏中の失敗（2026-10-01、Chrome）：AudioContext を止めたまま（無音）、一覧を読み込んだ後にオフラインスイッチを入れ、スケジューラの発音関数に `s("bd:5 hh:3 bd:5")`、`s("bd").bank("tr909")`、`note("c").s("gm_piano")`、`s("nosuchsound")` のハップを直接渡した。`failedFiles` は `tr909_bd`、`gm_piano`、`bd:5`、`hh:3` になり、`nosuchsound` は入らなかった。`bd:5 hh:3 bd:5` を 3 回（9 ハップ）渡してもイベントは 2 回だった。`retryFailedSounds()` の後も残り、ツールチップに出た。音を出しての通しの確認はしていない。

取り直し（2026-10-01、Chrome）：同じく無音で、発音関数にハップを直接渡した。

| 項目 | 結果 |
| --- | --- |
| `s("bd:5 hh:3")` をオフラインで 3 回 | 取得は 2 件（ファイルごとに 1 回）、`failedFiles` は `bd:5`、`hh:3` |
| 復帰直後（5 秒以内）にもう 1 回 | 取得しに行かず、一覧も残る |
| 5 秒後にもう 1 回 | 2 ファイルとも取得でき、一覧が空になった |
| `note("c3 e3").s("gm_piano")` をオフラインで、5 秒をはさんで 2 回ずつ | 取得は 5 秒ごとに 1 回（計 2 件） |
| 復帰して 5 秒後 | プリセットを取得でき、`gm_piano` が一覧から消えた。その後は取得し直さない |

未確認：ウェーブテーブル（サンプラーと同じ形の変更）、音を出しての通しの確認。

### 残っていること

- 完全オフライン対応の案：CDN の内容を手元に落とすスクリプトを用意し、取得先を切り替える。切り替え口は `prebake.ts` の `baseCDN` と、`@strudel/soundfonts` の `setSoundfontUrl`。音源をリポジトリに同梱する案は、容量と再配布のライセンス確認が要るので採らない。
- 計測用：`?strudelDev&strudelOffline` でオフライン状態から起動する。途中の切り替えは `strudelDev.offlineSwitch.offline`。このスイッチは `online` イベントを出さないので、復帰は `strudelDev.strudelDeckA.engine.retryFailedSounds()` で試す。

## Claude Code から書く（live/）（2026-10-01）

演奏しながら Claude Code に Strudel のコードを書かせるための仕組み。dev server（`pnpm dev`）でだけ動く。

### 決定事項

- ファイルは `live/A.strudel.js` / `live/B.strudel.js`（デッキごとに 1 つ）と `live/status.json`、`live/sounds.txt`。`live/` は git 管理外。
- ファイルが変わったら、そのデッキのエディタに入れて **キューまで** 進める。反映（Mod-R / Shift-Mod-R）は常に人が行う。
- 人がアプリでキュー（Mod-S）したコードはファイルに書き戻す。Claude は常に最新のキュー済みのコードを元に編集できる。
- 対象は Strudel デッキだけ。GLSL は同じ仕組みで後から足せる。

### 仕組み

- `vite/liveBridge.ts`（Vite プラグイン）が `live/` を `fs.watch` で監視し、変わったファイルの内容を HMR の WebSocket（カスタムイベント `wavenerd-live:*`、型は `src/live/liveProtocol.ts`）でアプリに送る。`live/` は Vite の監視から外してあるので、ファイルが変わってもページは再読み込みされない。
- アプリ側は `src/live/LiveBridge.ts`（`import.meta.hot` があるときだけ作る）。`Deck` がプッシュを受けると、`DeckEditor.replaceCode()` で差分だけを編集として入れ（カーソル・スクロール・ハイライトを保ち、Cmd-Z で戻せる。フォーカスは奪わない。DeckLog に `← live` と出る）、`handleCompile` でキューする。人がキューしていない手直しがあっても上書きする（Cmd-Z で戻せる）。
- コンパイルのたびに結果（エラー文、`StrudelCompiledCode.id`）をサーバーへ送る。プッシュされたコードなら、サーバーがファイルを読んだときのハッシュを付けて返すので、エディタが改行などを変えても照合がずれない。人がキューしたコードなら、サーバーがファイルに書き戻してからハッシュを取る。サーバーは前回読み書きした内容と比べて、書き戻しによる変更通知を無視する。
- `status.json`：`connected`（HMR クライアント数 > 0）、`serverPid`（dev server を kill すると `connected: true` が残るので、読み手はこのプロセスが生きているかも見る）、`transport`（`playing` / `bpm` / `xfader`）、デッキごとの `mode` / `cueStatus` / `error` / `lastCompile` / `fileState`。`fileState` はファイルの内容が `applied`（反映済み）/ `cued` / `error` / `not compiled` のどれか。反映済みかは、`codeId` → ハッシュの対応と `StrudelDeck.activeCodeId` で判断する。`codeId` はページを読み込み直すと 1 から数え直すので、アプリごとの `session` が変わったら対応を捨てる。状態は 0.5 秒ごとに見て、変わったときだけ送る。書き込みは一時ファイル経由の rename で行い、読み手が書きかけを読まないようにする。
- `sounds.txt`：`soundMap` の名前・種類・バリエーション数。エンジンの準備後と、`soundMap` が変わって 1 秒後に書き直す。名前は小文字（superdough が小文字にする）。
- アプリが開いていない間にファイルが変わったとき（dev server の起動時もそう見なす）：次に起動したアプリが最初のコンパイルを報告した時点で、内容が違えばファイルをプッシュし直し、キューさせる。アプリ自身のコード（OPFS）は通常どおり反映される。
- `scripts/live-wait.mjs`：ファイルのハッシュと一致する `lastCompile` が `status.json` に現れるまで（最大 5 秒）待ち、結果を出す。`.claude/settings.json` の PostToolUse フック（`--hook`）として、Write / Edit のたびに動く。`live/[AB].strudel.js` 以外のファイルではすぐ終わる。コンパイルエラーなら `decision: "block"` でエラー文を Claude に返し、成功なら `additionalContext` で「キューした／反映済み」と返す。Bash で書き換えたときはフックが動かないので、`node scripts/live-wait.mjs a` を手で実行する。
- `.claude/skills/strudel-live/SKILL.md`：Claude 向けの手順と wavenerd 固有の約束（1 cycle = 1 小節、`setcps` は効かない、`knob0`〜`knob7`、`sounds.txt` で名前を確かめる、対応する描画）。

### 確認結果（Chrome、AudioContext 停止中・トランスポート停止中）

- 起動するとデッキのコードが `live/` に書き出され、`status.json` は `connected: true`、両デッキ `applied` になる。`sounds.txt` は 1655 音
- ファイルを書き換えると、ページは再読み込みされず（`window.__marker` が残る）、エディタの中身が変わり `cueStatus: ready`、`fileState: cued` になる。カーソルとフォーカスはそのまま
- 構文エラーを書くと `fileState: error` とエラー文（`Unexpected token (行:列)`、行はファイルの行）。フックは Edit の直後にエラーを返した
- エディタで直して Mod-S すると、ファイルに書き戻され、書き戻しはプッシュし直されない
- プッシュの後の Cmd-Z で、プッシュ前の手直しに戻る
- タブを閉じた状態でファイルを書き換え、開き直すと、そのファイルがキューされる
- Shift-Mod-R で反映すると `fileState: applied` になる。ページを読み込み直した後も `applied` / `cued` を取り違えない
- `$:` を 2 行書くと 2 つのパターンが重なって鳴る形になり、`knob0.range(200, 8000)` は knob0 = 0.5 で cutoff 4100 になる。`setcps` / `setcpm` はエラーにならず、テンポも変わらない

未確認：音を出しての通しの確認、2 つ以上のタブを開いたとき（どちらもコンパイルし、`status.json` は後から書いた方になる）。

### 制限

- dev server が必要（本番ビルドには入らない）。タブは 1 つ、dev server も 1 つで使う。同じリポジトリで dev server を 2 つ動かすと、両方が `live/` を読み書きし、`status.json` は後から書いた方になる（2026-10-01 に実際に起きた。一時ファイル名が共通だったため rename が失敗し、片方のサーバーが例外で落ちた。一時ファイル名をプロセスごとに分け、プラグインの書き込みは失敗しても例外を投げないようにした）。
- Claude の応答には数秒〜数十秒かかる。片方のデッキを鳴らしながら、もう片方に書かせてクロスフェーダーでつなぐ使い方を想定している。

## 鳴らすときだけ出るエラー（2026-10-01）

Strudel の `Pattern.queryArc` は、クエリ中の例外を `errorLogger` でコンソールに出し、空の配列を返す。そのため、評価は通るがクエリで失敗するコード（例：`s("bd").fmap((v) => v.x.y)`、`s("bd*4").every(cat(1, 2), (x) => x.foo())`）は、反映すると一部の音が黙って鳴らなくなるだけで、デッキのエラーにも出なかった（スケジューラの `onError` には届かない）。

- コンパイル時に、現在の cycle から 4 cycle 分を試しにクエリする（`StrudelDeck.__trialQuery`）。cycle ごとに変わるパターン（`cat(1, 2)` など）のために複数 cycle を見る。例外を拾うため、`queryArc` ではなく `pattern.query(new State(new TimeSpan(…)))` を使う `queryPatternOrThrow()`（`src/strudel/patternQuery.ts`）を通す。描画を集めない扱いは `queryPattern()` と同じ。
- 失敗したらコンパイルエラーと同じ扱い：キューせず、エラー文の末尾に `(when played)` を付ける。`live/` のフックにも同じエラーが返る。
- 確認（Chrome、無音）：上の 2 例はキューされずエラーになる。`s("bd sd")`、`sine.range()`、`every(cat(1, 2), fast)`、`knob0.range()` と `_pianoroll()` はキューされ、描画も集まる。時間は 1〜2ms。
- 制限：試すのは現在位置からの 4 cycle だけ。それより先でだけ失敗するコード、knob の値によって失敗するコードは拾えない。演奏中のクエリの失敗は今も黙って無音になる（スケジューラも `queryPatternOrThrow` にすればデッキのエラーに出せる）。
