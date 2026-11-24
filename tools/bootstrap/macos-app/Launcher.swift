import AppKit
import Foundation
import Darwin

final class AssistantApp: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var status: NSTextField!
    var detail: NSTextField!
    var openButton: NSButton!
    var stopButton: NSButton!
    var task: Process?
    var workbench: URL?
    var output = ""
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
        openButton.bezelStyle = .rounded; openButton.keyEquivalent = "\r"; openButton.frame = NSRect(x: 30, y: 34, width: 142, height: 36); openButton.isEnabled = false; content.addSubview(openButton)
        stopButton = NSButton(title: "停止服务", target: self, action: #selector(stopService))
        stopButton.bezelStyle = .rounded; stopButton.frame = NSRect(x: 182, y: 34, width: 112, height: 36); stopButton.isEnabled = false; content.addSubview(stopButton)
        let help = NSButton(title: "使用手册", target: self, action: #selector(showGuide))
        help.bezelStyle = .rounded; help.frame = NSRect(x: 324, y: 34, width: 100, height: 36); content.addSubview(help)
        let logsButton = NSButton(title: "日志", target: self, action: #selector(showLogs))
        logsButton.bezelStyle = .rounded; logsButton.frame = NSRect(x: 432, y: 34, width: 74, height: 36); content.addSubview(logsButton)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        launch()
    }
    func consume(_ text: String) {
        log(text)
        output += text
        if output.count > 200000 { output = String(output.suffix(100000)) }
        let pattern = "Workbench: (http://127\\.0\\.0\\.1:[0-9]+)"
        if let expression = try? NSRegularExpression(pattern: pattern),
           let match = expression.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)),
           let range = Range(match.range(at: 1), in: output), let url = URL(string: String(output[range])) {
            workbench = url; status.stringValue = "工作台已就绪"; openButton.isEnabled = true; stopButton.isEnabled = true
            detail.stringValue = "开发任务在本机后台运行；关闭网页或这个窗口不停止任务。"
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
        guard task == nil else { return }
        let p = process("start"), stream = Pipe()
        p.standardOutput = stream; p.standardError = stream
        stream.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            let text = String(decoding: bytes, as: UTF8.self)
            DispatchQueue.main.async { self?.consume(text) }
        }
        p.terminationHandler = { [weak self] ended in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.task = nil
                if ended.terminationStatus != 0 && !self.quitting {
                    self.status.stringValue = "启动未完成"; self.detail.stringValue = "请打开日志查看原因，或参考使用手册中的启动排查。"
                    self.openButton.isEnabled = false
                }
            }
        }
        do { try p.run(); task = p } catch {
            log("Desktop launch error: \(error)\n")
            status.stringValue = "无法启动本地服务"; detail.stringValue = "请确认应用已完整复制到“应用程序”，再重新打开。"
        }
    }
    @objc func openWorkbench() {
        if let url = workbench { NSWorkspace.shared.open(url) }
        else { status.stringValue = "正在启动本地工作台…"; launch() }
    }
    @objc func showGuide() { NSWorkspace.shared.open(engine.appendingPathComponent("产品使用手册.html")) }
    @objc func showLogs() {
        if !FileManager.default.fileExists(atPath: logURL.path) { log("Desktop log\n") }
        NSWorkspace.shared.open(logURL)
    }
    @objc func stopService() { stop(quitAfter: false) }
    func stop(quitAfter: Bool) {
        guard !busy else { return }
        busy = true; stopButton.isEnabled = false; openButton.isEnabled = false
        status.stringValue = "正在正常停止服务…"
        let p = process("stop"), stream = Pipe()
        p.standardOutput = stream; p.standardError = stream
        do { try p.run() } catch {
            busy = false; status.stringValue = "停止未完成"; detail.stringValue = "请查看日志，保留运行现场。"
            if quitAfter { NSApp.reply(toApplicationShouldTerminate: false) }; return
        }
        DispatchQueue.global().async { [weak self] in
            let data = stream.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.log(String(decoding: data, as: UTF8.self)); self.busy = false
                if p.terminationStatus == 0 {
                    self.status.stringValue = "服务已停止"
                    self.detail.stringValue = "工作记录已保存在本机。点击“打开工作台”可以重新启动。"
                    self.workbench = nil; self.openButton.isEnabled = true
                    if quitAfter || self.quitRequested { self.quitting = true; NSApp.reply(toApplicationShouldTerminate: true) }
                } else {
                    self.status.stringValue = "停止结果尚未确认"
                    self.detail.stringValue = "请打开日志核对；应用会保留现场。"
                    self.stopButton.isEnabled = true; self.openButton.isEnabled = self.workbench != nil
                    if quitAfter || self.quitRequested { self.quitRequested = false; NSApp.reply(toApplicationShouldTerminate: false) }
                }
            }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }
        quitRequested = true
        if busy { return .terminateLater }
        stop(quitAfter: true); return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); if let url = workbench { NSWorkspace.shared.open(url) }; return true
    }
}
let app = NSApplication.shared
let delegate = AssistantApp()
app.delegate = delegate
app.run()
