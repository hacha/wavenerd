# Strudel 統合 設計（v2 最小構成）

最終更新: 2026-09-30（M4）

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
| 音源 | strudel.cc REPL の `prebake()` と同等のものを起動時に 1 回ロード（両デッキ共有） |
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
- Strudel モードではシェーダーライブラリ（`Mod-P`）を開かない。
- モード切り替えは `GLSL | Strudel` の 2 分割トグルで、現在のモードを反転色で示す。色は既存のテーマトークン（`bar-fg` / `bar-bg`）のみ。
- Strudel モードのエディタ（`src/view/codemirror/strudel.ts`）
  - JavaScript 言語モード＋既存テーマ。
  - mini-notation のハイライト：`"…"` とバッククォート（`${}` の中は除く）の中身を、数値・`~`・語・演算子に分けてテーマの `constants` / `comments` / `strings` / `operators` の色で塗る。シングルクォートは mini-notation ではないので対象外。
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

後回しにするもの：パターンのハイライト、widget（`_scope` など）、Strudel 用エディタテーマ、OPFS サンプルの Strudel からの利用。

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

未確認：Safari、Firefox、最小化したウィンドウ、6 分を超える無音、Chrome のメモリセーバーなどによるタブの凍結。

## 未決事項・リスク

- ~~**タブが裏にあるとき**~~：計測して対処済み。タイマーが間引かれるのは、タブが裏にあり、かつ無音が約 30 秒続いたときだけ。AudioWorklet（`TickNode`）からの tick で解決した。Safari / Firefox / 最小化したウィンドウは未確認。
- **Strudel モード中のクロック**：BeatManager はデッキの `update()` が再生中に呼ばれている間しか進まない。Strudel モードでも裏で GLSL デッキを再生し続ける（出力はミュート）前提にする。その間も GPU 描画は続くので負荷を確認する。
- **superdough の更新**：ルーティングの回避策は superdough 1.3.0 の内部構造に依存している（M0 で動作確認済み）。更新で内部が変わると壊れるので、バージョンを固定する。
- ~~**遅延の差**~~：M0 で確認済み（差は +0.49ms）。
- **外部 CDN への依存**：音源は `strudel.b-cdn.net` と `felixroos.github.io` から取得するので、オフライン時の挙動を決める必要がある。
