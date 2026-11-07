/**
 * 日本語バンドル。キーは zh-cn.ts と完全に一致する必要があります（MessageKey で強制）。
 */
import type { MessageKey } from './zh-cn';

export const ja: Record<MessageKey, string> = {
  // ---------------- 共通 ----------------
  'common.noProfile': '(profile なし)',
  'common.notInReactorSuffix': ' · reactor 外',
  'common.current': '現在',
  'common.default': '(デフォルト)',
  'common.remembered': '（記憶済み）',
  'common.fromConfigFile': '（設定ファイル由来）',
  'common.override': '（上書き）',
  'common.scanned': '（スキャン）',
  'common.scannedMainClass': '検出された起動クラス',
  'common.currentOverride': '現在の上書き',
  'common.followGlobal': 'グローバル設定に従う',
  'common.followGlobalMark': '（グローバル設定に従う）',
  'common.useAm': '-am を使用',
  'common.noAm': '-am を使用しない',
  'common.currentGlobal': '現在のグローバル設定：{0}',
  'common.enabled': '有効',
  'common.disabled': '無効',
  'common.currentMark': '（現在）',
  'common.useAmDesc': '依存モジュールもビルド',
  'common.noAmDesc': '現在のモジュールのみビルド（依存は install 済みが必要）',
  'common.enableCoverageDesc':
    '起動時に JaCoCo agent を装着し、停止/サンプリング時に dump してレポートを生成',
  'common.disableCoverageDesc': 'agent を装着しない',
  'common.ymlDefault': 'application.yml のデフォルト',
  'common.takesEffectAfterRestart': '（再起動後に反映）',
  'common.portOverrideCleared': '（ポート上書きを解除）',
  'common.unknownError': '不明なエラー',
  'common.unknownProcess': '不明なプロセス',
  'common.timeout': 'タイムアウト',
  'common.startFailed': '起動に失敗',
  'common.processExited': 'プロセスが終了',
  'common.listSeparator': '、',
  'common.groupSeparator': '；',

  // ---------------- ステータスバー ----------------
  'status.running': '{0} 実行中',
  'status.starting': '{0} 起動中',
  'status.appCount': '{0} 個のアプリ',
  'status.tooltip': 'クリックで Web Boot ビューを表示',

  // ---------------- アプリ状態 ----------------
  'state.stopped': '未実行',
  'state.starting': '起動中',
  'state.running': '実行中',
  'state.stopping': '停止中',

  // ---------------- ツリーコマンド ----------------
  'command.openInBrowser': 'ブラウザで開く',
  'command.run': '実行',

  // ---------------- グループ ----------------
  'group.ungrouped': '未分類',
  'group.appCount': '{0} 個のアプリ',
  'group.conflictSuffix': ' · ポート競合 {0} 件',
  'group.actionStart': '起動',
  'group.actionDebug': 'デバッグ',
  'group.startingGroup': '[グループ] {0}「{1}」：{2}',
  'group.aborted': '[グループ] {0} の{1}が完了せず、グループ全体の{1}を中止しました。',
  'group.stopping': '[グループ] 停止「{0}」：{1}',

  // ---------------- reactor の説明 ----------------
  'reactor.commentedOut':
    'reactor 外：親 pom の \u003cmodule> がコメントアウトされています',
  'reactor.notDeclared': 'reactor 外：親 pom にモジュールが宣言されていません',

  // ---------------- 出力ログ ----------------
  'log.scanSummary':
    '[スキャン] {0}：reactor モジュール {1} 件、起動可能アプリ {2} 件、ポート競合の影響アプリ {3} 件。',
  'log.scanFailed': '[スキャン失敗] {0}',
  'log.portKilling': '[ポート] {0} を占有するプロセスを終了：{1}',
  'log.portKilledPid': '[ポート] pid {0} を終了しました。',
  'log.portKillPidFailed': '[ポート] pid {0} の終了に失敗：{1}',
  'log.portReleased': '[ポート] ポート {0} を解放しました。',
  'log.portSwitched': '[ポート] {0} を {1} から {2} に変更しました。',
  'log.portStoppingManagedFor': '[ポート] {2} の起動のため {0}（{1} を占有）を停止します。',
  'log.portStoppingManaged': '[ポート] {0}（{1} を占有）を停止しています...',
  'log.portFreedByStop': '[ポート] {0} を停止し、ポート {1} を解放しました。',
  'log.portOwnerUnknown':
    '[ポート] ポート {0} は使用中ですが、占有プロセスを特定できませんでした（管理者権限が必要か、netstat / lsof がありません）。',
  'log.preference': '[設定] {0}: {1}',
  'log.groupCreated': '[グループ] グループ {0} を作成しました。',
  'log.groupRenamed': '[グループ] {0} を {1} に改名しました。',
  'log.groupDeleted': '[グループ] グループ {0} を削除しました。',
  'log.appMovedToGroup': '[グループ] {0} をグループ {1} に移動しました。',
  'log.appMovedToUngrouped': '[グループ] {0} を未分類に移動しました。',
  'log.restartStopping': '[再起動] {0} を停止しています...',
  'log.restartStarting': '[再起動] {0} を停止しました。起動します。',
  'log.restartStartingDebug': '[再起動] {0} を停止しました。デバッグ起動します。',
  'log.portConflictSection': '===== ポート競合チェック =====',
  'log.portConflictFlag': '  <-- 競合',
  'log.noPortConflicts': '  ポート競合は見つかりませんでした。',
  'log.noAppsHint':
    '[ヒント] 起動可能なアプリが見つかりません。ワークスペースのルート（またはサブディレクトリ）に pom.xml と @SpringBootApplication を付けた起動クラスがあるか確認してください。',
  'log.jacocoMissing':
    '[カバレッジ] ローカルリポジトリに {0} がありません。mvn dependency:get でダウンロードします...',
  'log.jacocoReady': '[カバレッジ] {0} を準備しました',
  'log.coverageTerminalUnsupported':
    '[カバレッジ] ターミナルモードでは dump できません（agent のポートとプロセスライフサイクルを取得できないため）。今回のカバレッジは無効です。',
  'log.reactorNote': '[ヒント] {0} のため -f で単独起動します。',
  'log.installHint':
    '[ヒント] 依存が見つからない場合は、先にルートで mvn install -DskipTests を実行してください。',
  'log.preBuild': '[1/2] プリビルド：{0}',
  'log.preBuildCancelled': '[キャンセル] プリビルド中に停止されたため、起動をキャンセルしました。',
  'log.preBuildFailed': '[失敗] プリビルドの終了コード {0} のため、起動を中止しました。',
  'log.starting': '[2/2] 起動：{0}',
  'log.portInUseHint':
    '[ヒント] ポートが使用中です。「ポートを解放（占有プロセスを終了）...」で占有者を終了するか、「ポートを指定して実行...」で別のポートを使用してください。',
  'log.runSkipped':
    '[失敗] spring-boot:run がスキップされました：pom の spring-boot.run.skip=true がコマンドラインで上書きされていません。',
  'log.runSkippedHint':
    '        モジュールの pom の \u003cproperties> に \u003cspring-boot.run.skip>false\u003c/spring-boot.run.skip> を追加してください。',
  'log.ready': '[準備完了] {0} が {1} で起動しました。',
  'log.exited': '[終了] {0} のプロセスが終了しました（終了コード {1}）。',
  'log.startFailedDetail': '[失敗] {0} {1}。上記のログを確認してください。',
  'log.readyTimeout':
    '[警告] {0} は {1} 秒を過ぎても準備完了ログが検出されません。出力ウィンドウで確認を続けてください。',
  'log.reloadingResources': '{0}  リソースを再読み込み  {1}',
  'log.resourcesUpdated': '[リソース] {0} のリソースを更新しました。',
  'log.resourcesStopped': '[リソース] {0} のリソース再読み込みを停止しました。',
  'log.processResourcesFailed': '[失敗] process-resources の終了コード {0}。',
  'log.coverageAttached':
    '[カバレッジ] {0} に JaCoCo {1} agent を装着：tcpserver 127.0.0.1:{2}、exec は {3} に累積します。',
  'log.coveragePrepareFailed':
    '[カバレッジ] 準備に失敗したため、今回のカバレッジは無効です：{0}',
  'log.coverageDumped': '[カバレッジ] {0} を dump しました（exec {1} 件をマージ）。',
  'log.coverageDumpFailed': '[カバレッジ] {0} の dump に失敗：{1}',
  'log.coverageNoExec':
    '[カバレッジ] {0} にはまだ exec データがありません。アプリを起動して API にアクセスしてからサンプリングしてください。',
  'log.coverageReport': '[カバレッジ] {0} 行 {1} / 分岐 {2} / クラス {3}、レポート：{4}',
  'log.coverageReportFailed': '[カバレッジ] {0} のレポート生成に失敗：{1}',
  'log.terminalModeHint':
    '[ヒント] ターミナルモードでは起動完了の検出と自動 attach はできません。デバッグには outputChannel モードに切り替えてください。',
  'log.stoppingBuild': '[停止] {0} のプリビルドを終了しています（pid {1}）...',
  'log.coverageDumpBeforeStop': '[カバレッジ] {0} の停止前に実行データを dump しています...',
  'log.stopping': '[停止] {0} を停止しています（pid {1}）...',
  'log.stopped': '[停止] {0} を停止しました。',
  'log.spawnFailed': '[起動失敗] {0}',

  // ---------------- 通知 ----------------
  'msg.scanFailed': 'Web Boot のスキャンに失敗：{0}',
  'msg.noRunningApps': '実行中のアプリはありません。',
  'msg.noApps': '起動可能な Spring Boot アプリが見つかりません。',
  'msg.portKillPartialFailed':
    'ポート {0} の一部プロセスの終了に失敗しました（{1}）。管理者権限が必要な可能性があります。',
  'msg.portStillOccupiedAfterKill': 'プロセスは終了しましたが、ポート {0} はまだ使用中です。',
  'msg.appAlreadyRunning': '{0} は既に実行中です。',
  'msg.portUsedByManaged':
    '{0} に設定されたポート {1} は、Web Boot で実行中の {2} が使用しています。',
  'msg.portStillUsedAfterStop': '{0} を停止しましたが、ポート {1} はまだ使用中のため、起動を中止しました。',
  'msg.portUsedUnknownOwner':
    '{0} に設定されたポート {1} は使用中ですが、占有プロセスを特定できませんでした（管理者権限が必要な可能性があります）。',
  'msg.portUsedAskKill':
    '{0} に設定されたポート {1} は使用中です。これらのプロセスを終了して起動しますか？',
  'msg.portAlreadyFree': 'ポート {0} は空いているため、解放は不要です。',
  'msg.portUsedByManagedSimple': 'ポート {0} は Web Boot で実行中の {1} が使用しています。',
  'msg.portReleasedByStopping': 'ポート {0} を解放しました（{1} を停止）。',
  'msg.portStillUsedAfterStopSimple': '{0} を停止しましたが、ポート {1} はまだ使用中です。',
  'msg.portUsedUnknownOwnerSimple':
    'ポート {0} は使用中ですが、占有プロセスを特定できませんでした（管理者権限が必要か、netstat / lsof がありません）。',
  'msg.confirmKillPort':
    'ポート {0} は使用中です。これらのプロセスを終了しますか？この操作は元に戻せません。',
  'msg.portReleased': 'ポート {0} を解放しました。',
  'msg.portReleaseFailed':
    'ポート {0} の解放に失敗しました。「Web Boot」出力ウィンドウを確認してください。',
  'msg.preferenceSaved': '{0} の設定を保存しました：{1}{2}。',
  'msg.groupCreated': 'グループ「{0}」を作成しました。アプリをドラッグして追加できます。',
  'msg.confirmDeleteGroup':
    'グループ「{0}」を削除しますか？グループ内の {1} 件のアプリは未分類になります。アプリ自体は削除されません。',
  'msg.groupEmpty': 'グループ「{0}」にはまだアプリがありません。',
  'msg.groupAllRunning': 'グループ「{0}」内のアプリはすべて実行中または起動中です。',
  'msg.groupAborted':
    'グループ「{0}」の{1}は {2} で中止されました。Web Boot の出力を確認してください。',
  'msg.groupNoRunning': 'グループ「{0}」内に実行中のアプリはありません。',
  'msg.appNotRunningForResources': '{0} は実行中ではありません。リソースを再読み込みする前に起動してください。',
  'msg.resourcesUpdated':
    '{0} のリソースを更新しました（mvn process-resources）。devtools が無効な場合は自動再起動しません。右クリックで「再起動」してください。',
  'msg.restartNotSupportedInTerminal':
    'ターミナルモードでは確実に再起動できません。ターミナルでアプリを停止してから再起動してください。',
  'msg.cannotResolveUrl': '{0} のアクセス URL を特定できません。',
  'msg.commandCopied': '{0} の起動コマンドをコピーしました。',
  'msg.noPortConflicts': 'ポート競合は見つかりませんでした。',
  'msg.portConflictsFound': 'ポート競合が {0} 件見つかりました — {1}',
  'msg.launchJsonWritten':
    '{0} に書き込みました（Web Boot 設定 {1} 件を更新、その他 {2} 件を保持）。',
  'msg.noCoverageReport':
    '{0} にはまだカバレッジレポートがありません。カバレッジを有効にしてアプリを起動し、API にアクセスしてからサンプリングしてください。',
  'msg.busy': '{0} は実行中または起動中です。先に停止してください。',
  'msg.preBuildFailed':
    '{0} のプリビルドに失敗しました（終了コード {1}）。Web Boot の出力を確認してください。',
  'msg.startFailed': '{0} {1}（終了コード {2}）。',
  'msg.readyTimeout':
    '{0} の起動がタイムアウトしました。Spring Boot の準備完了ログがないため、「Web Boot」出力ウィンドウを確認してください。',
  'msg.resourcesBusy': '{0} はリソースを再読み込み中です。しばらくお待ちください。',
  'msg.processResourcesFailed':
    '{0} のリソース再読み込みに失敗しました（終了コード {1}）。Web Boot の出力を確認してください。',
  'msg.coverageUnavailable': '{0} のカバレッジは利用できません：{1}',
  'msg.coverageNotEnabled':
    '{0} の今回の起動ではカバレッジが無効です。カバレッジを有効にして再起動してください。',
  'msg.coverageResult': '{0} のカバレッジ：行 {1}、分岐 {2}。',
  'msg.coverageNoData':
    '{0} にはまだカバレッジデータがありません。先にアプリを起動して API にアクセスしてください。',
  'msg.attachFailed':
    '{0} に attach できませんでした（ポート {1}）：{2}。Extension Pack for Java がインストールされているか確認してください。',

  // ---------------- エラー ----------------
  'error.noWorkspace': '先に pom.xml を含むワークスペースのルートを開いてください',
  'error.invalidPid': '不正な pid：{0}',
  'error.processAliveAfterSigkill': 'SIGKILL 後もプロセスが残っています',
  'error.jpsNotFound': 'jps / jstat が見つかりません（JRE ではなく JDK を使用しているか確認してください）',
  'error.jstatParse': 'jstat の出力を解析できません',
  'error.noMainClass': 'メインクラスが未設定のため、Java プロセスを特定できません',
  'error.javaProcessNotFound': 'メインクラスが {0} の Java プロセスが見つかりません',
  'error.toolNotFound':
    '{0} が見つかりません（JRE ではなく JDK を使用するか、webBoot.javaHome を設定してください）',
  'error.coverageNoClasses':
    '{0}/target/classes が見つかりません。カバレッジにはコンパイル済みバイトコードが必要です（プリビルドが none の場合は手動でコンパイルしてください）',
  'error.jacocoDownloadFailed': '{0} のダウンロードに失敗：{1}',
  'error.jacocoNotFound': '{0} が見つかりません（Maven ローカルリポジトリ {1} を確認してください）',

  // ---------------- 入力チェック ----------------
  'validate.port': '1〜65535 の整数を入力してください',
  'validate.portOrEmpty':
    '1〜65535 の整数を入力するか、空欄で設定ファイルのポートを使用してください',
  'validate.mainClassRequired': 'メインクラスの完全修飾名を入力してください',
  'validate.mainClassFqn':
    '有効な完全修飾クラス名を入力してください（例：com.example.MyApplication）',
  'validate.groupNameRequired': 'グループ名を入力してください',
  'validate.groupNameExists': '同じ名前のグループが既に存在します',

  // ---------------- 入力ボックス ----------------
  'prompt.releasePort': '解放するポートを入力してください（占有プロセスを終了します）',
  'prompt.springProfile': 'Spring profile（複数はカンマ区切り）',
  'prompt.inputPort': '{0} の待ち受けポートを入力してください',
  'prompt.inputPortWithConfig':
    '{0} の待ち受けポートを入力してください（空欄で設定ファイルの {1} を使用）',
  'prompt.mainClass': 'メインクラスの完全修飾名（例：com.example.MyApplication）',
  'prompt.newGroupName': '新しいグループ名',
  'prompt.renameGroup': 'グループ「{0}」の名前を変更',

  // ---------------- クイックピック ----------------
  'quickPick.pickAppToStop': '停止するアプリを選択',
  'quickPick.pickAppToStart': '起動するアプリを選択',
  'quickPick.manualInput': '$(edit) 手動入力...',
  'quickPick.pickProfile': '{0} の profile を選択',
  'quickPick.pickMainClass': '{0} のメインクラスを選択',
  'quickPick.editPreferences': '{0} の起動設定を編集',
  'quickPick.setBuildDependencies': '{0} で -am を付けるか設定',
  'quickPick.setCoverage': '{0} でカバレッジ（JaCoCo）を有効にするか設定',
  'quickPick.moveToGroup': '{0} をグループに移動',

  // ---------------- 設定項目 ----------------
  'label.port': '$(plug) ポート',
  'label.mainClass': '$(symbol-class) メインクラス',
  'label.buildDependencies': '$(package) 依存ビルド (-am)',
  'label.coverage': '$(pulse) カバレッジ (JaCoCo)',
  'label.followGlobal': '$(settings-gear) グローバル設定に従う',
  'label.useAm': '$(check) -am を使用',
  'label.noAm': '$(circle-slash) -am を使用しない',
  'label.enableCoverage': '$(check) カバレッジを有効化',
  'label.disableCoverage': '$(circle-slash) カバレッジを無効化',
  'label.ungrouped': '$(inbox) 未分類',
  'label.newGroup': '$(add) 新しいグループ...',

  // ---------------- 設定変更の要約 ----------------
  'detail.profile': 'profile {0}{1}',
  'detail.port': 'ポート {0}{1}',
  'detail.mainClass': 'メインクラス {0}{1}',
  'detail.buildDepsFollowGlobalUse': 'グローバル設定に従う（-am を使用）',
  'detail.buildDepsFollowGlobalNo': 'グローバル設定に従う（-am を使用しない）',
  'detail.buildDepsUseOverride': '-am を使用（上書き）',
  'detail.buildDepsNoOverride': '-am を使用しない（上書き）',
  'detail.coverageFollowGlobal': 'グローバル設定に従う（{0}）',
  'detail.coverageEnabledOverride': '有効（上書き）',
  'detail.coverageDisabledOverride': '無効（上書き）',

  // ---------------- ツールチップ / ツリー ----------------
  'tree.module': '- モジュール：`{0}`',
  'tree.mainClass': '- 起動クラス：`{0}`{1}',
  'tree.inReactor': '- reactor：はい',
  'tree.notInReactor': '- reactor：いいえ（{0}）',
  'tree.undeclared': '未宣言',
  'tree.profile': '- profile：`{0}`',
  'tree.port': '- ポート：`{0}`',
  'tree.contextPath': '- context-path：`{0}`',
  'tree.availableProfiles': '- 利用可能な profile：{0}',
  'tree.state': '- 状態：{0}',
  'tree.pid': '- pid：`{0}`',
  'tree.portConflict': '$(warning) **ポート競合**：{0} がすべて {1} を使用',
  'tree.lastCommand': '起動コマンド：',
  'tree.heap': 'ヒープ {0}%',
  'tree.httpUnreachable': 'HTTP 到達不能',
  'tree.connected': '接続済み',
  'tree.jvmMetric': '- JVM：{0}{1}',
  'tree.heapDetail': 'ヒープ {0} / {1}（{2}%）',
  'tree.heapDetailNoPercent': 'ヒープ {0} / {1}',
  'tree.gcDetail': '；YGC {0} 回 / {1} 秒、FGC {2} 回 / {3} 秒',
  'tree.jvmUnavailable': '- JVM：監視を利用できません（{0}）',
  'tree.tomcat': '- Tomcat：{0}{1}',
  'tree.httpDetail': 'HTTP {0}、{1}ms',
  'tree.httpUnreachableDetail': '到達不能（{0}）',
  'tree.httpUnreachableNoReason': '到達不能',
  'tree.threads': '；スレッド {0}/{1}',
  'tree.threadsNoMax': '；スレッド {0}',
  'tree.metricsUpdated': '- 監視更新：{0}',
  'tree.coverageSummary': 'カバレッジ {0}%',
  'tree.coverageAttached': '- カバレッジ：JaCoCo agent 装着済み（tcpserver {0}）',
  'tree.coverageRates': '- カバレッジ：行 {0} · 分岐 {1} · クラス {2}',
  'tree.coverageReportTime': '- レポート時刻：{0}',
  'tree.coverageReport': '- レポート：`{0}`',
  'tree.coverageError': '- カバレッジエラー：{0}',
  'tree.rateWithRatio': '{0}%（{1}/{2}）',
  'tree.groupApps': '- アプリ：{0} 件',
  'tree.groupAppList': '- {0}',
  'tree.groupConflicts': '- ポート競合：{0}',
  'tree.groupDragHint':
    'アプリをドラッグしてグループに追加できます。右クリックでグループ全体を起動/停止できます。',
  'tree.moreOwners': '  · 他に {0} 個のプロセス',

  // ---------------- ボタン ----------------
  'button.switchPort': '別のポートに変更',
  'button.keepPort': 'このポートを使用',
  'button.cancel': 'キャンセル',
  'button.stopItAndStart': '停止して起動',
  'button.killAndStart': '終了して起動',
  'button.stopIt': '停止する',
  'button.killProcess': 'プロセスを終了',
  'button.delete': '削除',
  'button.openFile': 'ファイルを開く',
};
