import AppKit
import Foundation
import CoreFoundation
import Darwin

// Desktop-only ownership of one launch/stop operation. Product execution authority stays in pa.
struct DesktopWorkspaceSession {
    enum Phase { case stopped, starting, ready, stopping, unknown }
    private(set) var generation = 0
    private(set) var phase: Phase = .stopped
    private(set) var output = ""
    private(set) var workbench: URL?
    var canSelectWorkspace: Bool { phase == .stopped && workbench == nil }
    mutating func beginLaunch() -> Int? {
        guard canSelectWorkspace else { return nil }
        generation += 1; output = ""; workbench = nil; phase = .starting
        return generation
    }
    mutating func consume(_ text: String, generation token: Int) -> URL? {
        guard token == generation && (phase == .starting || phase == .ready) else { return nil }
        output += text
        if output.count > 200000 { output = String(output.suffix(100000)) }
        let pattern = "^Workbench: (http://127\\.0\\.0\\.1:[0-9]+)\\r?\\n"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: .anchorsMatchLines),
              let match = expression.matches(in: output, range: NSRange(output.startIndex..., in: output)).last,
              let range = Range(match.range(at: 1), in: output),
              let url = URL(string: String(output[range])), let port = url.port, port >= 1024 && port <= 65535 else { return nil }
        return url
    }
    mutating func markReady(_ url: URL, generation token: Int) -> Bool {
        guard token == generation && phase == .starting else { return false }
        workbench = url; phase = .ready; return true
    }
    mutating func markUnknown(generation token: Int) {
        guard token == generation else { return }
        phase = .unknown
    }
    mutating func launchNotStarted(generation token: Int) {
        guard token == generation && phase == .starting else { return }
        phase = .stopped
    }
    mutating func beginStop() -> Int? {
        guard phase != .starting && phase != .stopping else { return nil }
        generation += 1; phase = .stopping
        return generation
    }
    mutating func completeStop(generation token: Int, confirmed: Bool) -> Bool {
        guard token == generation && phase == .stopping else { return false }
        if confirmed { phase = .stopped; workbench = nil; output = "" }
        else { phase = .unknown }
        return confirmed
    }
}

func desktopJSONBool(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
}

func desktopVerifiedWorkbench(_ data: Data, expectedRoot: URL, candidate: URL?) -> URL? {
    guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          body["status"] as? String == "RUNNING",
          let record = body["instance"] as? [String: Any],
          let roots = body["roots"] as? [String: Any],
          let recordRoot = record["state"] as? String, let requestedRoot = roots["data"] as? String,
          URL(fileURLWithPath: recordRoot).resolvingSymlinksInPath().standardizedFileURL == expectedRoot.resolvingSymlinksInPath().standardizedFileURL,
          URL(fileURLWithPath: requestedRoot).resolvingSymlinksInPath().standardizedFileURL == expectedRoot.resolvingSymlinksInPath().standardizedFileURL,
          let checks = body["checks"] as? [[String: Any]], !checks.isEmpty,
          checks.allSatisfy({ desktopJSONBool($0["ok"]) == true }),
          let text = record["consoleURL"] as? String, let url = URL(string: text),
          url.scheme == "http", url.host == "127.0.0.1", let port = url.port, port >= 1024 && port <= 65535,
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty || url.path == "/", candidate == nil || candidate == url else { return nil }
    return url
}

func desktopConfirmedStop(_ data: Data, exitStatus: Int32) -> Bool {
    guard exitStatus == 0, let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          desktopJSONBool(body["ok"]) == true, let status = body["status"] as? String else { return false }
    guard ["STOPPED", "STOPPED_ORPHAN", "STALE_RECORD_CLEANED"].contains(status) else { return false }
    // The no-record STOPPED response legitimately omits resource fields. If a field is present,
    // a contradictory or non-boolean value must never turn an uncertain stop into a root switch.
    if let alive = body["stillAlive"], desktopJSONBool(alive) != false { return false }
    if let stopped = body["stopped"], desktopJSONBool(stopped) != true { return false }
    if let removed = body["instanceRecordRemoved"], desktopJSONBool(removed) != true { return false }
    if status == "STOPPED_ORPHAN" {
        return desktopJSONBool(body["stopped"]) == true && desktopJSONBool(body["stillAlive"]) == false &&
            desktopJSONBool(body["instanceRecordRemoved"]) == true
    }
    if status == "STALE_RECORD_CLEANED" { return desktopJSONBool(body["instanceRecordRemoved"]) == true }
    return true
}

final class AssistantApp: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var status: NSTextField!
    var detail: NSTextField!
    var openButton: NSButton!
    var stopButton: NSButton!
    var task: Process?
    var session = DesktopWorkspaceSession()
    var workbench: URL? { session.workbench }
    var targetRoot: URL?
    var verificationGeneration: Int?
    var quitting = false
    var busy = false
    var quitRequested = false
    let resources = Bundle.main.resourceURL!
    var engine: URL { resources.appendingPathComponent("engine") }
    var support: URL {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path
        return URL(fileURLWithPath: home).appendingPathComponent("Library/Application Support/PersonalAgent/Desktop")
    }
    var logURL: URL { support.appendingPathComponent("logs/desktop.log") }
    func environment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        var paths = (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
        let home = env["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path
        paths += [home + "/.local/bin", home + "/.npm-global/bin", home + "/.volta/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        let nvm = URL(fileURLWithPath: home).appendingPathComponent(".nvm/versions/node")
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm.path) {
            for version in versions.sorted().reversed() where version.range(of: "^v[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil {
                let candidate = nvm.appendingPathComponent(version + "/bin")
                if FileManager.default.isExecutableFile(atPath: candidate.appendingPathComponent("codex").path) { paths.append(candidate.path) }
            }
        }
        env["PATH"] = ([engine.appendingPathComponent("runtime/bin").path] + paths).joined(separator: ":")
        env["PA_DESKTOP_APP"] = "1"
        env.removeValue(forKey: "PA_TARGET_DATA_ROOT")
        if let target = targetRoot { env["PA_TARGET_DATA_ROOT"] = target.path }
        return env
    }
    func log(_ text: String) {
        let parent = logURL.deletingLastPathComponent()
        for directory in [support.deletingLastPathComponent(), support, parent] {
            if !FileManager.default.fileExists(atPath: directory.path) {
                try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            }
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: directory.path),
                attrs[.type] as? FileAttributeType == .typeDirectory,
                (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077 == 0 else { return }
        }
        let fd = Darwin.open(logURL.path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { return }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
            info.st_mode & 0o077 == 0, info.st_size < 8 * 1024 * 1024 else { Darwin.close(fd); return }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        try? handle.write(contentsOf: Data(text.utf8)); try? handle.close()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu()
        let appMenu = NSMenuItem(); menu.addItem(appMenu)
        let items = NSMenu()
        let workspace = NSMenuItem(title: "打开已有工作区…", action: #selector(openWorkspace), keyEquivalent: "o"); workspace.target = self; items.addItem(workspace)
        let guide = NSMenuItem(title: "使用手册", action: #selector(showGuide), keyEquivalent: "?"); guide.target = self; items.addItem(guide)
        let logs = NSMenuItem(title: "打开日志", action: #selector(showLogs), keyEquivalent: "l"); logs.target = self; items.addItem(logs)
        items.addItem(.separator())
        let quit = NSMenuItem(title: "退出个人 Agent 助理", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); items.addItem(quit)
        appMenu.submenu = items; NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 300),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "个人 Agent 助理"; window.center()
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 300)); window.contentView = content
        let title = NSTextField(labelWithString: "个人 Agent 助理")
        title.font = .systemFont(ofSize: 28, weight: .semibold); title.frame = NSRect(x: 34, y: 225, width: 480, height: 38); content.addSubview(title)
        let subtitle = NSTextField(labelWithString: "讨论需求 · 委托开发 · 审阅交付")
        subtitle.textColor = .secondaryLabelColor; subtitle.font = .systemFont(ofSize: 14); subtitle.frame = NSRect(x: 36, y: 192, width: 480, height: 26); content.addSubview(subtitle)
        status = NSTextField(labelWithString: "正在启动本地工作台…")
        status.font = .systemFont(ofSize: 16, weight: .medium); status.frame = NSRect(x: 36, y: 139, width: 485, height: 28); content.addSubview(status)
        detail = NSTextField(wrappingLabelWithString: "首次使用请在工作台配置模型，并导入自己的 Git 项目。")
        detail.textColor = .secondaryLabelColor; detail.font = .systemFont(ofSize: 12); detail.frame = NSRect(x: 36, y: 94, width: 485, height: 40); content.addSubview(detail)
        openButton = NSButton(title: "打开工作台", target: self, action: #selector(openWorkbench))
        openButton.bezelStyle = .rounded; openButton.keyEquivalent = "\r"; openButton.frame = NSRect(x: 24, y: 34, width: 122, height: 36); openButton.isEnabled = false; content.addSubview(openButton)
        stopButton = NSButton(title: "停止服务", target: self, action: #selector(stopService))
        stopButton.bezelStyle = .rounded; stopButton.frame = NSRect(x: 150, y: 34, width: 100, height: 36); stopButton.isEnabled = false; content.addSubview(stopButton)
        let workspaceButton = NSButton(title: "已有工作区", target: self, action: #selector(openWorkspace))
        workspaceButton.bezelStyle = .rounded; workspaceButton.frame = NSRect(x: 254, y: 34, width: 116, height: 36); content.addSubview(workspaceButton)
        let help = NSButton(title: "使用手册", target: self, action: #selector(showGuide))
        help.bezelStyle = .rounded; help.frame = NSRect(x: 374, y: 34, width: 88, height: 36); content.addSubview(help)
        let logsButton = NSButton(title: "日志", target: self, action: #selector(showLogs))
        logsButton.bezelStyle = .rounded; logsButton.frame = NSRect(x: 466, y: 34, width: 64, height: 36); content.addSubview(logsButton)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        launch()
    }
    func consume(_ text: String, generation token: Int) {
        log(text)
        if let candidate = session.consume(text, generation: token), session.phase == .starting {
            verifyWorkbench(candidate: candidate, generation: token)
        }
    }
    func verifyWorkbench(candidate: URL?, generation token: Int) {
        guard token == session.generation && session.phase == .starting && verificationGeneration != token else { return }
        verificationGeneration = token
        let expectedRoot = targetRoot ?? support.appendingPathComponent("data")
        let p = process("status"), stream = Pipe()
        p.standardOutput = stream; p.standardError = stream
        do { try p.run() } catch {
            verificationGeneration = nil; session.markUnknown(generation: token)
            status.stringValue = "启动状态尚未确认"; detail.stringValue = "请正常停止或查看日志；不会切换工作区或使用旧地址。"
            stopButton.isEnabled = true; return
        }
        DispatchQueue.global().async { [weak self] in
            let data = stream.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            DispatchQueue.main.async {
                guard let self = self, token == self.session.generation else { return }
                self.verificationGeneration = nil
                guard p.terminationStatus == 0, let url = desktopVerifiedWorkbench(data, expectedRoot: expectedRoot, candidate: candidate),
                      self.session.markReady(url, generation: token) else {
                    self.session.markUnknown(generation: token)
                    self.status.stringValue = "启动状态尚未确认"; self.detail.stringValue = "当前工作区与启动结果未能核对；保留现场，请正常停止或查看日志。"
                    self.openButton.isEnabled = false; self.stopButton.isEnabled = true
                    if self.quitRequested { self.quitRequested = false; NSApp.reply(toApplicationShouldTerminate: false) }
                    return
                }
                self.status.stringValue = "工作台已就绪"; self.openButton.isEnabled = true; self.stopButton.isEnabled = true
                self.detail.stringValue = "开发任务在本机后台运行；关闭网页或这个窗口不停止任务。"
                if self.quitRequested { self.stop(quitAfter: true) }
            }
        }
    }
    func process(_ action: String) -> Process {
        let p = Process()
        p.executableURL = engine.appendingPathComponent("runtime/bin/node")
        p.arguments = [engine.appendingPathComponent("personal-preview-launcher.mjs").path, action]
        p.currentDirectoryURL = engine; p.environment = environment()
        return p
    }
    func launch() {
        guard !busy && task == nil, let token = session.beginLaunch() else { return }
        verificationGeneration = nil; openButton.isEnabled = false; stopButton.isEnabled = false
        let p = process("start"), stream = Pipe()
        p.standardOutput = stream; p.standardError = stream
        stream.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            let text = String(decoding: bytes, as: UTF8.self)
            DispatchQueue.main.async { self?.consume(text, generation: token) }
        }
        p.terminationHandler = { [weak self] ended in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.task === ended { self.task = nil }
                guard token == self.session.generation else { return }
                if ended.terminationStatus == 0 && self.session.phase == .starting {
                    self.verifyWorkbench(candidate: nil, generation: token)
                } else if ended.terminationStatus != 0 && !self.quitting {
                    self.session.markUnknown(generation: token)
                    self.status.stringValue = "启动结果尚未确认"; self.detail.stringValue = "请正常停止或查看日志；当前工作区与现场保留。"
                    self.openButton.isEnabled = false; self.stopButton.isEnabled = true
                    if self.quitRequested { self.quitRequested = false; NSApp.reply(toApplicationShouldTerminate: false) }
                }
            }
        }
        do { try p.run(); task = p } catch {
            session.launchNotStarted(generation: token)
            log("Desktop launch error: \(error)\n")
            status.stringValue = "无法启动本地服务"; detail.stringValue = "请确认应用已完整复制到“应用程序”，再重新打开。"
            openButton.isEnabled = true
        }
    }
    @objc func openWorkbench() {
        guard !busy else { return }
        if session.phase == .ready, let url = workbench { NSWorkspace.shared.open(url) }
        else if session.canSelectWorkspace { status.stringValue = "正在启动本地工作台…"; launch() }
        else { status.stringValue = "当前服务状态尚未确认"; detail.stringValue = "请先正常停止服务；不会重新启动或使用旧工作台地址。" }
    }
    @objc func openWorkspace() {
        if busy || !session.canSelectWorkspace || task != nil {
            status.stringValue = "请先停止当前服务"; detail.stringValue = "启动中、已就绪或停止结果未知时不能切换工作区；先等待启动结果并正常停止。"
            return
        }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.prompt = "选择已有工作区"; panel.message = "选择恢复来源（只读）或已准备的新工作区；路径选择本身不授予执行权。"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard !busy && session.canSelectWorkspace && task == nil else { return }
        targetRoot = url; status.stringValue = "正在打开已有工作区…"; detail.stringValue = "将使用原恢复授权校验；路径选择不替代授权。"
        openButton.isEnabled = false; launch()
    }
    @objc func showGuide() { NSWorkspace.shared.open(engine.appendingPathComponent("产品使用手册.html")) }
    @objc func showLogs() {
        if !FileManager.default.fileExists(atPath: logURL.path) { log("Desktop log\n") }
        NSWorkspace.shared.open(logURL)
    }
    @objc func stopService() { stop(quitAfter: false) }
    func stop(quitAfter: Bool) {
        guard !busy else { return }
        guard let token = session.beginStop() else {
            status.stringValue = "请等待当前启动完成"; detail.stringValue = "尚未确认服务状态，不能并发停止或切换工作区。"
            return
        }
        busy = true; verificationGeneration = nil; stopButton.isEnabled = false; openButton.isEnabled = false
        status.stringValue = "正在正常停止服务…"
        let p = process("stop"), stream = Pipe()
        p.standardOutput = stream; p.standardError = stream
        do { try p.run() } catch {
            busy = false; _ = session.completeStop(generation: token, confirmed: false)
            status.stringValue = "停止未完成"; detail.stringValue = "请查看日志，保留当前工作区与运行现场。"
            stopButton.isEnabled = true
            if quitAfter || quitRequested { quitRequested = false; NSApp.reply(toApplicationShouldTerminate: false) }; return
        }
        DispatchQueue.global().async { [weak self] in
            let data = stream.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            DispatchQueue.main.async {
                guard let self = self, token == self.session.generation else { return }
                self.log(String(decoding: data, as: UTF8.self)); self.busy = false
                let confirmed = desktopConfirmedStop(data, exitStatus: p.terminationStatus)
                if self.session.completeStop(generation: token, confirmed: confirmed) {
                    self.status.stringValue = "服务已停止"
                    self.detail.stringValue = "工作记录已保存在本机。可重新打开工作台，或选择另一个已授权工作区。"
                    self.openButton.isEnabled = true
                    if quitAfter || self.quitRequested { self.quitting = true; NSApp.reply(toApplicationShouldTerminate: true) }
                } else {
                    self.status.stringValue = "停止结果尚未确认"
                    self.detail.stringValue = "请打开日志核对；当前工作区与现场保持，不能切换到其他目录。"
                    self.stopButton.isEnabled = true; self.openButton.isEnabled = false
                    if quitAfter || self.quitRequested { self.quitRequested = false; NSApp.reply(toApplicationShouldTerminate: false) }
                }
            }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }
        quitRequested = true
        if busy || session.phase == .starting { return .terminateLater }
        stop(quitAfter: true); return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        if !busy && session.phase == .ready, let url = workbench { NSWorkspace.shared.open(url) }
        return true
    }
}
#if !DESKTOP_WORKSPACE_SELECTION_TESTS
let app = NSApplication.shared
let delegate = AssistantApp()
app.delegate = delegate
app.run()
#endif
