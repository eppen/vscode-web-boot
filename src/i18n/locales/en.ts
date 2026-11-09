/**
 * English bundle. Keys must match zh-cn.ts exactly (enforced by MessageKey).
 */
import type { MessageKey } from './zh-cn';

export const en: Record<MessageKey, string> = {
  // ---------------- Common ----------------
  'common.noProfile': '(no profile)',
  'common.notInReactorSuffix': ' · not in reactor',
  'common.current': 'Current',
  'common.default': '(default)',
  'common.remembered': ' (remembered)',
  'common.fromConfigFile': ' (from config file)',
  'common.override': ' (override)',
  'common.scanned': ' (scanned)',
  'common.scannedMainClass': 'Detected main class',
  'common.currentOverride': 'Current override',
  'common.followGlobal': 'Follow global setting',
  'common.followGlobalMark': ' (follows global setting)',
  'common.useAm': 'Use -am',
  'common.noAm': "Don't use -am",
  'common.currentGlobal': 'Current global: {0}',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',
  'common.currentMark': ' (current)',
  'common.useAmDesc': 'Also build dependency modules',
  'common.noAmDesc': 'Build only this module; dependencies must already be installed',
  'common.enableCoverageDesc':
    'Attach the JaCoCo agent on start; dump and generate a report on stop/sample',
  'common.disableCoverageDesc': "Don't attach the agent",
  'common.ymlDefault': 'application.yml default',
  'common.takesEffectAfterRestart': ' (takes effect after restart)',
  'common.portOverrideCleared': ' (port override cleared)',
  'common.unknownError': 'Unknown error',
  'common.unknownProcess': 'Unknown process',
  'common.unknownPort': 'unknown',
  'common.timeout': 'Timeout',
  'common.startFailed': 'failed to start',
  'common.processExited': 'process exited',
  'common.listSeparator': ', ',
  'common.groupSeparator': '; ',

  // ---------------- Status bar ----------------
  'status.running': '{0} running',
  'status.starting': '{0} starting',
  'status.appCount': '{0} apps',
  'status.tooltip': 'Click to reveal the Web Boot view',

  // ---------------- App state ----------------
  'state.stopped': 'Stopped',
  'state.starting': 'Starting',
  'state.running': 'Running',
  'state.stopping': 'Stopping',

  // ---------------- Tree command titles ----------------
  'command.openInBrowser': 'Open in Browser',
  'command.run': 'Run',

  // ---------------- Groups ----------------
  'group.ungrouped': 'Ungrouped',
  'group.appCount': '{0} apps',
  'group.conflictSuffix': ' · {0} port conflict(s)',
  'group.actionStart': 'start',
  'group.actionDebug': 'debug',
  'group.startingGroup': '[Group] {0} "{1}": {2}',
  'group.aborted': '[Group] {0}: {1} did not finish; group action aborted.',
  'group.stopping': '[Group] Stopping "{0}": {1}',

  // ---------------- Reactor notes ----------------
  'reactor.commentedOut': 'Not in reactor: the \u003cmodule> entry in the parent pom is commented out',
  'reactor.notDeclared': 'Not in reactor: the module is not declared in the parent pom',

  // ---------------- Output channel logs ----------------
  'log.scanSummary':
    '[Scan] {0}: {1} reactor modules, {2} launchable apps, {3} apps affected by port conflicts.',
  'log.scanFailed': '[Scan failed] {0}',
  'log.portKilling': '[Port] Terminating processes on port {0}: {1}',
  'log.portKilledPid': '[Port] Terminated pid {0}.',
  'log.portKillPidFailed': '[Port] Failed to terminate pid {0}: {1}',
  'log.portReleased': '[Port] Port {0} released.',
  'log.portSwitched': '[Port] {0} changed from {1} to {2}.',
  'log.portStoppingManagedFor': '[Port] Stopping {0} (using {1}) so {2} can start.',
  'log.portStoppingManaged': '[Port] Stopping {0} (using {1})...',
  'log.portFreedByStop': '[Port] {0} stopped; port {1} released.',
  'log.portOwnerUnknown':
    '[Port] Port {0} is in use but the owning process could not be identified (administrator rights may be required, or netstat / lsof is missing).',
  'log.preference': '[Preference] {0}: {1}',
  'log.groupCreated': '[Group] Created group {0}.',
  'log.groupRenamed': '[Group] Renamed {0} to {1}.',
  'log.groupDeleted': '[Group] Deleted group {0}.',
  'log.appMovedToGroup': '[Group] Moved {0} to group {1}.',
  'log.appMovedToUngrouped': '[Group] Moved {0} to Ungrouped.',
  'log.restartStopping': '[Restart] Stopping {0}...',
  'log.restartStarting': '[Restart] {0} stopped; starting.',
  'log.restartStartingDebug': '[Restart] {0} stopped; starting in debug mode.',
  'log.restartWaitingPort': '[Restart] Waiting for port {0} to be released...',
  'log.restartPortStillOccupied':
    '[Restart] Port {0} is still in use; continuing launch. Release the port manually if it still conflicts.',
  'log.portConflictSection': '===== Port conflict check =====',
  'log.portConflictFlag': '  <-- conflict',
  'log.noPortConflicts': '  No port conflicts found.',
  'log.noAppsHint':
    '[Hint] No launchable apps found. Make sure the workspace root (or a subdirectory) contains pom.xml and a class annotated with @SpringBootApplication.',
  'log.jacocoMissing':
    '[Coverage] Artifact {0} is missing from the local repository; running mvn dependency:get...',
  'log.jacocoReady': '[Coverage] Prepared {0}',
  'log.coverageTerminalUnsupported':
    '[Coverage] Cannot dump in terminal mode (agent port and process lifecycle are unavailable); coverage is disabled for this run.',
  'log.reactorNote': '[Hint] {0}; will launch standalone with -f.',
  'log.installHint':
    '[Hint] If dependencies are missing, run mvn install -DskipTests at the root first.',
  'log.preBuild': '[1/2] Pre-build: {0}',
  'log.preBuildCancelled': '[Cancelled] Stopped during pre-build; launch cancelled.',
  'log.preBuildFailed': '[Failed] Pre-build exited with code {0}; launch aborted.',
  'log.starting': '[2/2] Starting: {0}',
  'log.portInUseHint':
    '[Hint] Port already in use. Use "Release Port (Kill Owning Process)..." to stop the owner, or "Run with Port..." to choose another port.',
  'log.runSkipped':
    '[Failed] spring-boot:run was skipped: spring-boot.run.skip=true in the pom and not overridden on the command line.',
  'log.runSkippedHint':
    '        Add \u003cspring-boot.run.skip>false\u003c/spring-boot.run.skip> to the module pom\u0027s \u003cproperties>.',
  'log.ready': '[Ready] {0} started at {1}.',
  'log.exited': '[Exit] {0} process ended (exit code {1}).',
  'log.startFailedDetail': '[Failed] {0} {1}. See the log above for details.',
  'log.readyTimeout':
    '[Warning] No ready log detected for {0} after {1}s; keep watching the output window.',
  'log.reloadingResources': '{0}  Reloading resources  {1}',
  'log.resourcesUpdated': '[Resources] {0} resources updated.',
  'log.resourcesStopped': '[Resources] {0} resource reload stopped.',
  'log.processResourcesFailed': '[Failed] process-resources exited with code {0}.',
  'log.coverageAttached':
    '[Coverage] {0} attached JaCoCo {1} agent: tcpserver 127.0.0.1:{2}, exec accumulates in {3}.',
  'log.coveragePrepareFailed':
    '[Coverage] Setup failed; coverage is disabled for this run: {0}',
  'log.coverageDumped': '[Coverage] {0} dumped ({1} exec file(s) merged).',
  'log.coverageDumpFailed': '[Coverage] {0} dump failed: {1}',
  'log.coverageNoExec':
    '[Coverage] {0} has no exec data yet; start the app, call some endpoints, then sample.',
  'log.coverageReport': '[Coverage] {0} line {1} / branch {2} / class {3}, report: {4}',
  'log.coverageReportFailed': '[Coverage] {0} report generation failed: {1}',
  'log.terminalModeHint':
    '[Hint] Terminal mode cannot detect startup completion or auto-attach; switch to outputChannel mode for debugging.',
  'log.stoppingBuild': '[Stop] Terminating pre-build for {0} (pid {1})...',
  'log.coverageDumpBeforeStop': '[Coverage] Dumping execution data for {0} before it stops...',
  'log.stopping': '[Stop] Stopping {0} (pid {1})...',
  'log.stopped': '[Stop] {0} stopped.',
  'log.adopted':
    '[Adopted] {0} is still running from the previous session (pid {1}, port {2}); its log output is gone — restart the app if you need logs. Command: {3}',
  'log.adoptedExited': '[Adopted] The process for {0} (pid {1}) is gone; state reset to stopped.',
  'log.stoppingAdopted':
    '[Stop] {0} runs in a process left over from the previous session; stopping pid {1}...',
  'log.stoppingAdoptedFailed': '[Stop] Failed to stop {0} (pid {1}): {2}',
  'log.restoreStale':
    '[Restore] The recorded process for {0} (pid {1}) has exited; kept as stopped.',
  'log.spawnFailed': '[Spawn failed] {0}',

  // ---------------- Notifications ----------------
  'msg.scanFailed': 'Web Boot scan failed: {0}',
  'msg.noRunningApps': 'No running apps.',
  'msg.noApps': 'No launchable Spring Boot apps found.',
  'msg.restoredApps': 'Adopted {0} app(s) still running from before the restart: {1}',
  'msg.portKillPartialFailed':
    'Failed to terminate some processes on port {0} ({1}); administrator rights may be required.',
  'msg.portStillOccupiedAfterKill': 'Processes were terminated, but port {0} is still in use.',
  'msg.appAlreadyRunning': '{0} is already running.',
  'msg.portUsedByManaged':
    'The port {1} configured for {0} is in use by {2}, which is running in Web Boot.',
  'msg.portStillUsedAfterStop': '{0} stopped, but port {1} is still in use; launch aborted.',
  'msg.portUsedUnknownOwner':
    'The port {1} configured for {0} is in use, but the owning process could not be identified (administrator rights may be required).',
  'msg.portUsedAskKill':
    'The port {1} configured for {0} is in use. Terminate these processes and start?',
  'msg.portAlreadyFree': 'Port {0} is already free; nothing to release.',
  'msg.portUsedByManagedSimple': 'Port {0} is in use by {1}, which is running in Web Boot.',
  'msg.portReleasedByStopping': 'Port {0} released (stopped {1}).',
  'msg.portStillUsedAfterStopSimple': 'Stopped {0}, but port {1} is still in use.',
  'msg.portUsedUnknownOwnerSimple':
    'Port {0} is in use, but the owning process could not be identified (administrator rights may be required, or netstat / lsof is missing).',
  'msg.confirmKillPort':
    'Port {0} is in use. Terminate these processes? This cannot be undone.',
  'msg.portReleased': 'Port {0} released.',
  'msg.portReleaseFailed': 'Failed to release port {0}; see the "Web Boot" output window.',
  'msg.preferenceSaved': '{0} preference saved: {1}{2}.',
  'msg.groupCreated': 'Group "{0}" created. Drag apps into it to add them.',
  'msg.confirmDeleteGroup':
    'Delete group "{0}"? Its {1} app(s) will become ungrouped; the apps themselves are not deleted.',
  'msg.groupEmpty': 'Group "{0}" has no apps yet.',
  'msg.groupAllRunning': 'All apps in group "{0}" are already running or starting.',
  'msg.groupAborted': 'Group "{0}" {1} aborted at {2}; see the Web Boot output.',
  'msg.groupNoRunning': 'Group "{0}" has no running apps.',
  'msg.appNotRunningForResources': '{0} is not running. Start it before reloading resources.',
  'msg.resourcesUpdated':
    '{0} resources updated (mvn process-resources). Without devtools the app will not restart automatically; right-click "Restart".',
  'msg.restartNotSupportedInTerminal':
    'Cannot reliably restart in terminal mode: stop the app in the terminal first, then start it again.',
  'msg.cannotResolveUrl': 'Cannot determine the URL for {0}.',
  'msg.commandCopied': 'Copied the launch command for {0}.',
  'msg.noPortConflicts': 'No port conflicts found.',
  'msg.portConflictsFound': 'Found {0} port conflict group(s) — {1}',
  'msg.launchJsonWritten':
    'Wrote {0} (updated {1} Web Boot configuration(s), kept {2} other(s)).',
  'msg.noCoverageReport':
    '{0} has no coverage report yet: enable coverage, start the app, call some endpoints, then sample.',
  'msg.busy': '{0} is running or starting; stop it first.',
  'msg.preBuildFailed': '{0} pre-build failed (exit code {1}); see the Web Boot output.',
  'msg.startFailed': '{0} {1} (exit code {2}).',
  'msg.readyTimeout':
    '{0} startup timed out without a Spring Boot ready log; see the "Web Boot" output window.',
  'msg.resourcesBusy': '{0} is already reloading resources; please wait.',
  'msg.processResourcesFailed':
    '{0} reloading resources failed (exit code {1}); see the Web Boot output.',
  'msg.coverageUnavailable': '{0} coverage unavailable: {1}',
  'msg.coverageNotEnabled':
    'Coverage was not enabled for this run of {0}; enable coverage and restart.',
  'msg.coverageResult': '{0} coverage: line {1}, branch {2}.',
  'msg.coverageNoData':
    '{0} has no coverage data yet; start the app and call some endpoints first.',
  'msg.attachFailed':
    'Failed to attach to {0} (port {1}): {2}. Make sure the Extension Pack for Java is installed.',
  'msg.startSuccess': '{0} started successfully. URL: {1}',
  'msg.restartSuccess': '{0} restarted successfully. URL: {1}',
  'msg.groupStarted': 'Started {1} app(s) in group "{0}".',

  // ---------------- Errors ----------------
  'error.noWorkspace': 'Open a workspace root containing pom.xml first.',
  'error.invalidPid': 'Invalid pid: {0}',
  'error.processAliveAfterSigkill': 'Process still exists after SIGKILL',
  'error.jpsNotFound': 'jps / jstat not found (make sure you are using a JDK, not a JRE)',
  'error.jstatParse': 'Cannot parse jstat output',
  'error.noMainClass': 'Main class not configured; cannot locate the Java process',
  'error.javaProcessNotFound': 'No Java process found with main class {0}',
  'error.toolNotFound':
    '{0} not found (make sure you are using a JDK, not a JRE, or configure webBoot.javaHome)',
  'error.coverageNoClasses':
    '{0}/target/classes not found; coverage needs compiled bytecode (compile manually when pre-build is none)',
  'error.jacocoDownloadFailed': 'Failed to download {0}: {1}',
  'error.jacocoNotFound': '{0} not found (check the Maven local repository {1})',

  // ---------------- Validation ----------------
  'validate.port': 'Enter an integer between 1 and 65535',
  'validate.portOrEmpty':
    'Enter an integer between 1 and 65535, or leave empty to use the configured port',
  'validate.mainClassRequired': 'Enter the fully qualified main class name',
  'validate.mainClassFqn':
    'Enter a valid fully qualified class name, e.g. com.example.MyApplication',
  'validate.groupNameRequired': 'Enter a group name',
  'validate.groupNameExists': 'A group with this name already exists',

  // ---------------- Input boxes ----------------
  'prompt.releasePort': 'Enter the port to release (the owning process will be terminated)',
  'prompt.springProfile': 'Spring profile (comma-separated for multiple)',
  'prompt.inputPort': 'Enter the listening port for {0}',
  'prompt.inputPortWithConfig':
    'Enter the listening port for {0} (leave empty to use {1} from the config file)',
  'prompt.mainClass': 'Fully qualified main class name, e.g. com.example.MyApplication',
  'prompt.newGroupName': 'New group name',
  'prompt.renameGroup': 'Rename group "{0}"',

  // ---------------- Quick picks ----------------
  'quickPick.pickAppToStop': 'Select an app to stop',
  'quickPick.pickAppToStart': 'Select an app to start',
  'quickPick.manualInput': '$(edit) Enter manually...',
  'quickPick.pickProfile': 'Select a profile for {0}',
  'quickPick.pickMainClass': 'Select the main class for {0}',
  'quickPick.editPreferences': 'Edit the launch settings for {0}',
  'quickPick.setBuildDependencies': 'Set whether {0} appends -am',
  'quickPick.setCoverage': 'Set whether coverage (JaCoCo) is enabled for {0}',
  'quickPick.moveToGroup': 'Move {0} to a group',

  // ---------------- Preference items ----------------
  'label.port': '$(plug) Port',
  'label.mainClass': '$(symbol-class) Main class',
  'label.buildDependencies': '$(package) Build dependencies (-am)',
  'label.coverage': '$(pulse) Coverage (JaCoCo)',
  'label.followGlobal': '$(settings-gear) Follow global setting',
  'label.useAm': '$(check) Use -am',
  'label.noAm': "$(circle-slash) Don't use -am",
  'label.enableCoverage': '$(check) Enable coverage',
  'label.disableCoverage': '$(circle-slash) Disable coverage',
  'label.ungrouped': '$(inbox) Ungrouped',
  'label.newGroup': '$(add) New group...',

  // ---------------- Preference summaries ----------------
  'detail.profile': 'profile {0}{1}',
  'detail.port': 'port {0}{1}',
  'detail.mainClass': 'main class {0}{1}',
  'detail.buildDepsFollowGlobalUse': 'follow global setting (use -am)',
  'detail.buildDepsFollowGlobalNo': "follow global setting (don't use -am)",
  'detail.buildDepsUseOverride': 'use -am (override)',
  'detail.buildDepsNoOverride': "don't use -am (override)",
  'detail.coverageFollowGlobal': 'follow global setting ({0})',
  'detail.coverageEnabledOverride': 'enabled (override)',
  'detail.coverageDisabledOverride': 'disabled (override)',

  // ---------------- Tooltips / tree ----------------
  'tree.module': '- Module: `{0}`',
  'tree.mainClass': '- Main class: `{0}`{1}',
  'tree.inReactor': '- reactor: yes',
  'tree.notInReactor': '- reactor: no ({0})',
  'tree.undeclared': 'not declared',
  'tree.profile': '- profile: `{0}`',
  'tree.port': '- Port: `{0}`',
  'tree.contextPath': '- context-path: `{0}`',
  'tree.availableProfiles': '- Available profiles: {0}',
  'tree.state': '- State: {0}',
  'tree.pid': '- pid: `{0}`',
  'tree.portConflict': '$(warning) **Port conflict**: {0} all use {1}',
  'tree.lastCommand': 'Launch command:',
  'tree.heap': 'Heap {0}%',
  'tree.httpUnreachable': 'HTTP unreachable',
  'tree.connected': 'Connected',
  'tree.jvmMetric': '- JVM: {0}{1}',
  'tree.heapDetail': 'heap {0} / {1} ({2}%)',
  'tree.heapDetailNoPercent': 'heap {0} / {1}',
  'tree.gcDetail': '; YGC {0} / {1}s, FGC {2} / {3}s',
  'tree.jvmUnavailable': '- JVM: monitoring unavailable ({0})',
  'tree.tomcat': '- Tomcat: {0}{1}',
  'tree.httpDetail': 'HTTP {0}, {1}ms',
  'tree.httpUnreachableDetail': 'unreachable ({0})',
  'tree.httpUnreachableNoReason': 'unreachable',
  'tree.threads': '; threads {0}/{1}',
  'tree.threadsNoMax': '; threads {0}',
  'tree.metricsUpdated': '- Metrics updated: {0}',
  'tree.coverageSummary': 'Coverage {0}%',
  'tree.coverageAttached': '- Coverage: JaCoCo agent attached (tcpserver {0})',
  'tree.coverageRates': '- Coverage: line {0} · branch {1} · class {2}',
  'tree.coverageReportTime': '- Report time: {0}',
  'tree.coverageReport': '- Report: `{0}`',
  'tree.coverageError': '- Coverage error: {0}',
  'tree.rateWithRatio': '{0}% ({1}/{2})',
  'tree.groupApps': '- Apps: {0}',
  'tree.groupAppList': '- {0}',
  'tree.groupConflicts': '- Port conflicts: {0}',
  'tree.groupDragHint':
    'Drag apps in to add them to this group; right-click to start/stop the whole group.',
  'tree.moreOwners': '  · {0} more process(es)',

  // ---------------- Buttons ----------------
  'button.switchPort': 'Switch Port',
  'button.keepPort': 'Keep This Port',
  'button.cancel': 'Cancel',
  'button.stopItAndStart': 'Stop It and Start',
  'button.killAndStart': 'Kill and Start',
  'button.stopIt': 'Stop It',
  'button.killProcess': 'Kill Process',
  'button.delete': 'Delete',
  'button.openFile': 'Open File',
};
