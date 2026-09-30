# Strudel 統合 設計（v2 最小構成）

最終更新: 2026-09-30

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

UI（Deck / DeckStatusBar / DeckEditor）から GLSL デッキと同じように扱えるよう、共通インターフェイス `IDeck` を実装する。

- `compile(code)`
  - `repl.evaluate(code, false)` を呼ぶ。
  - 評価結果（`evaluate()` の戻り値のパターン。エラー時は `undefined`）を `staged` に保存する。`autostart=false` なら Cyclist は起動しないので、`scheduler.setPattern` の上書きは不要（M0 で確認）。
  - 状態は `compiling` → `ready` と遷移する（エラー時は `none` にして `error` を発行）。
- `applyCue()`：状態を `applying` にし、次の小節頭で反映する。
- `applyCueImmediately()`：即時に反映する。
- 巻き戻し時は、GLSL デッキと同じく `staged` を即時反映する。
- `setParam(name, value)`：knob ストアを更新する。
- イベント名・状態名は wavenerd-deck に合わせる：`changeCueStatus`、`error`、`'none' | 'compiling' | 'ready' | 'applying'`。

### 5. 初期化（`src/strudel/initStrudel.ts`）

- `setAudioContext(audio)` で、wavenerd と同じ AudioContext を使う。
- `evalScope(controls, mini, tonal, webaudio, { knob0..knob7 })` を実行する。
- `prebake` と同じ音源をロードする：シンセ、ZZFX、soundfonts、`strudel.b-cdn.net` の piano / VCSL / drum machines / Dirt-Samples 抜粋など。
- `repl.evaluate()` は evalScope のグローバルを書き換えるので、全デッキ共通の Promise キューで直列化する。
- 各 repl には異なる `id` を渡す。

### 6. knob（MIDI 連携）

- `knob0`〜`knob7` は、デッキごとの値ストアを読む `ref()` パターンとして提供する。
  - 例：`s("bd*4").lpf(knob0.range(200, 8000))`
- 評価時にはどのデッキのコードかが分かるので、そのデッキ用の knob を注入する。
  - evalScope はグローバルなので、評価キューの中でデッキごとに差し替えてから評価する。
- 既存の `MIDIMAN` → `deckX.setParam('knobN')` の経路で、Strudel 側のストアも更新する。
- 反映遅延は先読み分（約 0.1〜0.2 秒）。

### 7. UI

- デッキごとにモード切り替え（GLSL / Strudel）を置く。
- コードの保存先はモードごとに分ける。
- Strudel モードのエディタは JavaScript 言語モード＋既存テーマにする（見た目の作り込みは後回し）。
- キー操作・状態表示は GLSL デッキと共通。

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
2. **M1 音の経路**：ライセンス変更、`initStrudel`、`DeckSourceSwitch`、`StrudelDeck` の最小実装（まずは Cyclist のまま）。
3. **M2 同期と cue**：`StrudelScheduler` への置き換え、`Mod-S` / `Mod-R` / `Shift-Mod-R`。
4. **M3 knob**：`knob0`〜`knob7` と MIDI 連携。
5. **M4 UI**：モード切り替え UI、モードごとのコード保存。

後回しにするもの：パターンのハイライト、widget（`_scope` など）、Strudel 用エディタテーマ、OPFS サンプルの Strudel からの利用。

## M0 スパイク結果（2026-09-30）

コード：`src/strudel/`（`DeckOutputController` / `DeckClock` / `StrudelScheduler` は M1 以降でも使う）、`src/strudel/spike/`（使い捨て）。`?strudelSpike` を付けて起動すると `window.strudelSpike` から操作できる。

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

未確認：ミキサーのチャンネル音量を 0 にしたとき、Strudel の音が完全に消えるか（耳で確認する）。

## 未決事項・リスク

- **Strudel モード中のクロック**：BeatManager はデッキの `update()` が再生中に呼ばれている間しか進まない。Strudel モードでも裏で GLSL デッキを再生し続ける（出力はミュート）前提にする。その間も GPU 描画は続くので負荷を確認する。
- **ブラウザ未検証**：ルーティングの回避策は superdough 1.3.0 のソースを読んで立てたもので、まだ動かしていない。更新で内部が変わると壊れるので、superdough はバージョンを固定する。
- ~~**遅延の差**~~：M0 で確認済み（差は +0.49ms）。
- **外部 CDN への依存**：音源は `strudel.b-cdn.net` と `felixroos.github.io` から取得するので、オフライン時の挙動を決める必要がある。
