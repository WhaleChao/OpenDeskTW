import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showFileImporter = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(nsColor: .windowBackgroundColor), Color.teal.opacity(0.07)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    QuickStartPanel(openAction: { showFileImporter = true })
                    if let analysis = model.analysis {
                        DocumentWorkspace(analysis: analysis)
                    } else {
                        RecentDocumentsPanel()
                        dropZone
                    }
                    CapabilityCenter()
                    OfficeSelfTestPanel()
                    MAGIConnectionPanel()
                    statusBar
                }
                .padding(28)
            }
        }
        .toolbar {
            ToolbarItemGroup {
                Menu {
                    ForEach(NewDocumentType.allCases) { type in
                        Button {
                            model.createDocument(type)
                        } label: {
                            Label(type.actionTitle, systemImage: type.iconName)
                        }
                    }
                } label: {
                    Label("新增", systemImage: "plus")
                }
                Button {
                    showFileImporter = true
                } label: {
                    Label("開啟文件", systemImage: "folder.badge.plus")
                }
                Button {
                    model.revealBackup()
                } label: {
                    Label("備份", systemImage: "clock.arrow.circlepath")
                }
                Button {
                    model.refreshSystemStatuses()
                } label: {
                    Label("重新檢查", systemImage: "arrow.clockwise")
                }
            }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let url = urls.first {
                model.selectDocument(url)
            }
        }
        .dropDestination(for: URL.self, action: { urls, _ in
            guard let url = urls.first else { return false }
            model.selectDocument(url)
            return true
        }, isTargeted: { model.isDropTargeted = $0 })
        .onOpenURL { url in
            model.selectDocument(url)
        }
        .onReceive(NotificationCenter.default.publisher(for: .openDeskRequestOpen)) { _ in
            showFileImporter = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .openDeskReceivedDocument)) { notification in
            if let url = notification.userInfo?["url"] as? URL {
                model.selectDocument(url)
            }
        }
        .onAppear {
            model.refreshSystemStatuses()
            DispatchQueue.main.async {
                if let window = NSApp.windows.first {
                    window.setContentSize(NSSize(width: 1120, height: 760))
                    window.center()
                    window.makeKeyAndOrderFront(nil)
                }
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 18) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [.teal, .blue], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: "doc.on.doc.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 68, height: 68)
            .shadow(color: .teal.opacity(0.22), radius: 14, y: 7)

            VStack(alignment: .leading, spacing: 5) {
                Text("OpenDesk TW")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                Text("完整日常文書、本機文件保護、Office 格式優先相容")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 7) {
                Label("本機模式", systemImage: "lock.shield.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.green)
                EngineSummary(statuses: model.engineStatuses)
            }
        }
    }

    private var dropZone: some View {
        VStack(spacing: 14) {
            Image(systemName: model.isDropTargeted ? "arrow.down.doc.fill" : "doc.badge.plus")
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(model.isDropTargeted ? .teal : .secondary)
            Text(model.isDropTargeted ? "放開以檢查文件" : "拖入 Office 文件開始")
                .font(.title3.weight(.semibold))
            Text("支援 DOCX、XLSX、PPTX、PDF、ODF 與舊版 Office 格式")
                .foregroundStyle(.secondary)
            Button("選擇文件…") { showFileImporter = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 170)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.background.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(style: StrokeStyle(lineWidth: 1.5, dash: [8]))
                        .foregroundStyle(model.isDropTargeted ? Color.teal : Color.secondary.opacity(0.35))
                )
        )
    }

    private var statusBar: some View {
        HStack(spacing: 10) {
            if model.isWorking {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
            Text(model.statusMessage)
                .lineLimit(2)
            Spacer()
            if model.lastPDFURL != nil {
                Button("顯示 PDF") { model.revealLastPDF() }
            }
            if model.lastRenumberedURL != nil {
                Button("顯示重新編號文件") { model.revealLastRenumbered() }
            }
            if model.lastBackupURL != nil {
                Button("顯示備份") { model.revealBackup() }
            }
        }
        .font(.callout)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct OfficeSelfTestPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var showDetails = false

    private var accent: Color {
        guard let report = model.officeSelfTestReport else { return .indigo }
        return report.passed ? .green : .orange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(accent.opacity(0.11))
                    if model.isRunningOfficeSelfTest {
                        ProgressView()
                    } else {
                        Image(systemName: model.officeSelfTestReport?.passed == true ? "checkmark.seal.fill" : "checkmark.shield.fill")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 3) {
                    Text("完整 Office 相容性自我檢查")
                        .font(.headline)
                    if let report = model.officeSelfTestReport {
                        Text("\(report.summary)・\(report.runAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("用內建高複雜度 DOCX、XLSX、PPTX 實檔驗證結構、讀取與 PDF 輸出。")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if model.officeSelfTestReport != nil {
                    Button(showDetails ? "收合結果" : "查看結果") {
                        withAnimation(.easeInOut(duration: 0.18)) { showDetails.toggle() }
                    }
                    Button("顯示報告") { model.revealOfficeSelfTestReport() }
                }
                Button(model.isRunningOfficeSelfTest ? "檢查中…" : "執行完整檢查") {
                    model.runOfficeSelfTest()
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isRunningOfficeSelfTest)
            }

            if showDetails, let report = model.officeSelfTestReport {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 235), spacing: 10)], spacing: 10) {
                    ForEach(report.groups) { group in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Image(systemName: group.passed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .foregroundStyle(group.passed ? Color.green : Color.orange)
                                Text(group.name).font(.callout.weight(.bold))
                                Spacer()
                                Text("\(group.passedCount)/\(group.checks.count)")
                                    .font(.caption.monospacedDigit().weight(.semibold))
                            }
                            ForEach(group.checks.filter { !$0.passed }) { item in
                                Text("• \(item.name)：\(item.detail)")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            if group.passed {
                                Text("全部通過")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(11)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 11))
                    }
                }
                ForEach(report.boundaries, id: \.self) { boundary in
                    Label(boundary, systemImage: "exclamationmark.shield")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(16)
        .background(.background.opacity(0.82), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
    }
}

private struct QuickStartPanel: View {
    @EnvironmentObject private var model: AppModel
    let openAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("開始使用")
                        .font(.title3.weight(.bold))
                    Text("先選要建立的檔案，或直接開啟現有文件。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("⌘N 新增文字文件　⌘O 開啟")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 215), spacing: 12)], spacing: 12) {
                QuickActionCard(
                    title: "新增文字文件",
                    subtitle: "DOCX・A4・繁體中文字型",
                    icon: "doc.text.fill",
                    color: .blue
                ) { model.createDocument(.text) }
                QuickActionCard(
                    title: "新增試算表",
                    subtitle: "XLSX・公式・圖表・頁籤",
                    icon: "tablecells.fill",
                    color: .green
                ) { model.createDocument(.spreadsheet) }
                QuickActionCard(
                    title: "新增簡報",
                    subtitle: "PPTX・16:9・標題版面",
                    icon: "rectangle.on.rectangle.angled",
                    color: .orange
                ) { model.createDocument(.presentation) }
                QuickActionCard(
                    title: "開啟現有文件",
                    subtitle: "DOCX／XLSX／PPTX／PDF／舊格式",
                    icon: "folder.fill.badge.plus",
                    color: .teal,
                    action: openAction
                )
            }
        }
    }
}

private struct QuickActionCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 42, height: 42)
                    .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(15)
            .frame(maxWidth: .infinity)
            .background(.background.opacity(0.82), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(subtitle)
    }
}

private struct RecentDocumentsPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var showAll = false

    private var displayedDocuments: [RecentDocumentRecord] {
        showAll ? model.recentDocuments : Array(model.recentDocuments.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("最近文件")
                        .font(.title3.weight(.bold))
                    Text("按一下即可先檢查、建立備份，再繼續編輯。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if model.recentDocuments.count > 6 {
                    Button(showAll ? "收合" : "顯示全部（\(model.recentDocuments.count)）") {
                        withAnimation(.easeInOut(duration: 0.18)) { showAll.toggle() }
                    }
                }
                if !model.recentDocuments.isEmpty {
                    Button("清除清單") { model.clearRecentDocuments() }
                        .help("只清除最近文件紀錄，不會刪除任何文件")
                }
            }

            if displayedDocuments.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(.secondary)
                    Text("尚無最近文件。新建或開啟後會自動出現在這裡。")
                        .foregroundStyle(.secondary)
                }
                .padding(15)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background.opacity(0.58), in: RoundedRectangle(cornerRadius: 14))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 310), spacing: 12)], spacing: 12) {
                    ForEach(displayedDocuments) { record in
                        RecentDocumentCard(record: record)
                    }
                }
            }
        }
    }
}

private struct RecentDocumentCard: View {
    @EnvironmentObject private var model: AppModel
    let record: RecentDocumentRecord

    private var icon: String {
        switch record.kind {
        case .text: return "doc.text.fill"
        case .spreadsheet: return "tablecells.fill"
        case .presentation: return "rectangle.on.rectangle.angled"
        case .pdf: return "doc.richtext.fill"
        case .openDocument: return "doc.badge.gearshape"
        case .legacy: return "archivebox.fill"
        case .unknown: return "doc.fill"
        }
    }

    private var color: Color {
        switch record.kind {
        case .text: return .blue
        case .spreadsheet: return .green
        case .presentation: return .orange
        case .pdf: return .red
        case .openDocument, .legacy: return .purple
        case .unknown: return .secondary
        }
    }

    var body: some View {
        Button {
            model.openRecentDocument(record)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 38, height: 38)
                    .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(record.fileName)
                        .font(.callout.weight(.semibold))
                        .lineLimit(1)
                    Text("\(record.folderName)・\(record.lastOpened.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("繼續編輯")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tint)
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.opacity(0.78), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(.quaternary))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("顯示於 Finder") { model.revealRecentDocument(record) }
            Button("從最近文件移除") { model.removeRecentDocument(record) }
        }
        .accessibilityHint("先檢查並備份，再用建議的編輯器開啟")
    }
}

private struct CapabilityCenter: View {
    @EnvironmentObject private var model: AppModel
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "square.grid.2x2.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.teal)
                    .frame(width: 46, height: 46)
                    .background(Color.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text("完整功能中心")
                        .font(.title3.weight(.bold))
                    Text("文字、試算表、簡報、PDF 與安全工具都保留在原生編輯器中。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                HStack(spacing: 8) {
                    CapabilityChip(title: "排版", icon: "textformat")
                    CapabilityChip(title: "資料", icon: "function")
                    CapabilityChip(title: "簡報", icon: "play.rectangle")
                    CapabilityChip(title: "PDF", icon: "doc.richtext")
                }
                Button(isExpanded ? "收合" : "查看全部功能") {
                    withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
                }
                .buttonStyle(.bordered)
            }

            if isExpanded {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 235), spacing: 12)], spacing: 12) {
                    CapabilityModuleCard(
                        title: "文字文件",
                        icon: "doc.text.fill",
                        color: .blue,
                        items: ["字型、樣式、段落與清單", "表格、圖片、圖表與圖形", "標題、目錄、註腳與尾註", "分節、浮水印、頁碼與頁首頁尾", "書籤、交互參照與圖表目錄", "方程式、表單與郵件合併", "比較、註解、追蹤修訂與保護", "搜尋取代、列印、另存與 PDF"],
                        actionTitle: "新增文字文件"
                    ) { model.createDocument(.text) }
                    CapabilityModuleCard(
                        title: "試算表",
                        icon: "tablecells.fill",
                        color: .green,
                        items: ["多工作表、頁籤與凍結窗格", "公式、函數與命名範圍", "格式化表格、排序與篩選", "圖表、樞紐分析與切片器", "條件格式與資料驗證", "群組、移除重複值與外部連結", "圖形、方程式與 SmartArt", "工作表保護、列印版面與 PDF"],
                        actionTitle: "新增試算表"
                    ) { model.createDocument(.spreadsheet) }
                    CapabilityModuleCard(
                        title: "簡報",
                        icon: "rectangle.on.rectangle.angled",
                        color: .orange,
                        items: ["佈景、版面與投影片母片", "文字、表格、圖表與 SmartArt", "圖片、音訊、視訊與圖形", "物件對齊、排列與群組", "轉場、動畫與動作路徑", "頁尾、投影片編號與講義", "備忘稿、簡報者檢視與放映", "搜尋取代、密碼保護、列印與 PDF"],
                        actionTitle: "新增簡報"
                    ) { model.createDocument(.presentation) }
                    CapabilityModuleCard(
                        title: "共同工具",
                        icon: "wrench.and.screwdriver.fill",
                        color: .purple,
                        items: ["開啟舊版 Office 與 ODF", "原檔直開與版本備份", "字型檢查與替代建議", "離線轉換 PDF", "中文標題辨識、重編與 MAGI"],
                        actionTitle: "開啟救援引擎"
                    ) { model.launchEngine(.libreOffice) }
                }

                CompatibilityBoundaryPanel()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(17)
        .background(.background.opacity(0.78), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.quaternary))
    }
}

private struct CapabilityChip: View {
    let title: String
    let icon: String

    var body: some View {
        Label(title, systemImage: icon)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.45), in: Capsule())
    }
}

private struct CapabilityModuleCard: View {
    let title: String
    let icon: String
    let color: Color
    let items: [String]
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(color)
            ForEach(items, id: \.self) { item in
                Label(item, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .labelStyle(CapabilityLabelStyle(color: color))
            }
            Spacer(minLength: 2)
            Button(actionTitle, action: action)
                .buttonStyle(.bordered)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 270, alignment: .topLeading)
        .background(color.opacity(0.045), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.14)))
    }
}

private struct CapabilityLabelStyle: LabelStyle {
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            configuration.icon.foregroundStyle(color)
            configuration.title
        }
    }
}

private struct CompatibilityBoundaryPanel: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 5) {
                Text("Microsoft 專屬功能會保留原檔並先提醒")
                    .font(.callout.weight(.bold))
                Text("VBA／ActiveX／COM 增益集、IRM 權限、Microsoft 365 雲端共同編輯，以及部分複雜 SmartArt 或 3D 物件，無法保證與 Microsoft Office 完全相同。OpenDesk TW 會先掃描、備份，必要時以安全副本開啟，不會暗中轉掉原格式。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct EngineSummary: View {
    let statuses: [EngineStatus]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(statuses) { status in
                HStack(spacing: 5) {
                    Circle()
                        .fill(status.installed ? Color.green : Color.red)
                        .frame(width: 7, height: 7)
                    Text(status.version.map { "\(status.engine.displayName) \($0)" } ?? status.engine.displayName)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct DocumentWorkspace: View {
    @EnvironmentObject private var model: AppModel
    let analysis: DocumentAnalysis

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(analysis.fileName)
                        .font(.title2.weight(.bold))
                        .lineLimit(2)
                    HStack(spacing: 10) {
                        Text(analysis.kind.displayName)
                        Text(analysis.humanSize)
                        Text(analysis.fileExtension.uppercased())
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                RiskBadge(level: analysis.riskLevel)
            }

            Divider()

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 175), spacing: 10)], spacing: 10) {
                Button {
                    model.openPreferred()
                } label: {
                    Label("備份並用 \(analysis.preferredEngine.displayName) 開啟", systemImage: "doc.badge.gearshape")
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)

                Button("改用 \(analysis.alternateEngine.displayName)") {
                    model.openAlternate()
                }
                .disabled(model.isWorking)

                if analysis.kind != .pdf {
                    Button {
                        model.convertSelectedToPDF()
                    } label: {
                        Label("轉換 PDF", systemImage: "doc.richtext")
                    }
                    .disabled(model.isWorking)
                }

                if !analysis.detectedHeadings.isEmpty {
                    Button {
                        model.renumberChineseHeadings()
                    } label: {
                        Label("重編 \(analysis.detectedHeadings.count) 個中文標題", systemImage: "list.number")
                    }
                    .disabled(model.isWorking)
                        .help("保留原檔與版本備份，建立套用標題層級的重新編號副本")
                }

                Button {
                    model.revealSelectedDocument()
                } label: {
                    Label("顯示於 Finder", systemImage: "folder")
                }
            }

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Label("相容性檢查", systemImage: "checklist.checked")
                        .font(.headline)
                    ForEach(analysis.issues) { issue in
                        IssueRow(issue: issue)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 10) {
                    Label("字型與套件", systemImage: "textformat")
                        .font(.headline)
                    if analysis.detectedFonts.isEmpty {
                        Text("未從文件樣式中讀到明確字型。")
                            .foregroundStyle(.secondary)
                    } else {
                        FlowText(
                            values: analysis.detectedFonts,
                            missing: Set(analysis.missingFonts),
                            substitutions: analysis.fontSubstitutions
                        )
                    }
                    Text("已檢查 \(analysis.packageEntriesInspected) 個 OOXML 項目")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    if !analysis.detectedHeadings.isEmpty {
                        Divider()
                        Label("中文標題層級", systemImage: "text.badge.checkmark")
                            .font(.callout.weight(.semibold))
                        ForEach(analysis.detectedHeadings.prefix(6)) { heading in
                            Text("標題 \(heading.level)　\(heading.text)")
                                .font(.caption)
                                .lineLimit(1)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let report = model.documentHealthReport {
                DocumentHealthPanel(report: report)
            }
            MAGIAnalysisPanel()
        }
        .padding(22)
        .background(.background.opacity(0.84), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(.quaternary))
    }
}

private struct DocumentHealthPanel: View {
    let report: DocumentHealthReport

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("本機文件健檢", systemImage: "checkmark.shield.fill")
                    .font(.headline)
                Spacer()
                Text(report.conclusion)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.teal)
            }
            HStack(alignment: .top, spacing: 12) {
                ForEach(report.verdicts) { verdict in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(verdict.title).font(.callout.weight(.bold))
                            Spacer()
                            Text(verdict.outcome.displayName)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(verdict.outcome == .passed ? .green : verdict.outcome == .attention ? .orange : .red)
                        }
                        Text(verdict.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(.top, 2)
    }
}

private struct RiskBadge: View {
    let level: RiskLevel

    private var color: Color {
        switch level {
        case .normal: return .green
        case .attention: return .orange
        case .high: return .red
        }
    }

    var body: some View {
        Text(level.displayName)
            .font(.callout.weight(.bold))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}

private struct IssueRow: View {
    let issue: CompatibilityIssue

    private var color: Color {
        switch issue.level {
        case .normal: return .green
        case .attention: return .orange
        case .high: return .red
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: issue.level == .normal ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(color)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(issue.title).font(.callout.weight(.semibold))
                Text(issue.detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct FlowText: View {
    let values: [String]
    let missing: Set<String>
    let substitutions: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(values.prefix(10), id: \.self) { value in
                HStack(spacing: 7) {
                    Image(systemName: missing.contains(value) ? "exclamationmark.circle" : substitutions[value] == nil ? "checkmark.circle" : "arrow.triangle.swap")
                        .foregroundStyle(missing.contains(value) ? .orange : substitutions[value] == nil ? .green : .blue)
                    Text(substitutions[value].map { "\(value) → \($0)" } ?? value)
                        .font(.callout)
                }
            }
            if values.count > 10 {
                Text("另有 \(values.count - 10) 種字型")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            Section("編輯引擎") {
                ForEach(model.engineStatuses) { status in
                    LabeledContent(status.engine.displayName) {
                        Text(status.installed ? "已安裝 \(status.version ?? "")" : "尚未安裝")
                            .foregroundStyle(status.installed ? .green : .red)
                    }
                }
                Button("重新檢查引擎與 MAGI") { model.refreshSystemStatuses() }
            }
            Section("MAGI AI 助理") {
                LabeledContent("目前版本", value: model.magiStatus?.activeVersion.displayName ?? "檢查中")
                LabeledContent("單一版本保護", value: model.magiStatus?.singleActiveSafe == false ? "發現衝突" : "正常")
                LabeledContent("V3 相容契約", value: model.magiStatus?.v3Compatibility.compatible == true ? "已驗證" : "待確認")
                Button("開啟 MAGI 本機主控台") { model.openMAGIConsole() }
                Text("OpenDesk TW 會在您按下分析後擷取文件文字，直接呼叫本機 MAGI 並在程式內顯示結果；不會自動分析或上傳到外部網路。V2 與 V3 永遠不會由本程式同時啟動。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("文件保護") {
                LabeledContent("版本備份", value: "每次開啟與轉 PDF 前")
                LabeledContent("保留數量", value: "每份文件最近 20 版／30 天")
                LabeledContent("高風險文件", value: "唯讀安全副本")
                Button("顯示備份資料夾") { model.revealBackup() }
            }
            Section("完整相容性自我檢查") {
                LabeledContent("最近結果", value: model.officeSelfTestReport?.summary ?? "尚未執行")
                Button(model.isRunningOfficeSelfTest ? "檢查中…" : "執行完整 Office 檢查") { model.runOfficeSelfTest() }
                    .disabled(model.isRunningOfficeSelfTest)
                if model.officeSelfTestReport != nil {
                    Button("顯示 JSON 驗證報告") { model.revealOfficeSelfTestReport() }
                }
            }
            Section("格式與文字快捷鍵") {
                LabeledContent("粗體／斜體／底線", value: "⌘B／⌘I／⌘U")
                LabeledContent("複製／貼上／復原", value: "⌘C／⌘V／⌘Z")
                LabeledContent("複製／套用格式", value: "⌥⌘C／⌥⌘V")
                LabeledContent("儲存／另存新檔／列印", value: "⌘S／⇧⌘S／⌘P")
                LabeledContent("格式刷", value: "首頁工具列 → 複製樣式（可雙擊連續套用）")
                LabeledContent("中文標題重編", value: "⌥⌘R")
                Text("文件編輯時的文字熱鍵由 ONLYOFFICE 原生處理；OpenDesk TW 另提供中文法律文件標題辨識與安全重編。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("隱私") {
                Text("OpenDesk TW 的掃描、備份與 PDF 轉換均在本機完成；不會自動上傳文件。")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(24)
        .onAppear { model.refreshSystemStatuses() }
    }
}

private struct MAGIConnectionPanel: View {
    @EnvironmentObject private var model: AppModel

    private var statusColor: Color {
        guard let report = model.magiStatus else { return .secondary }
        if !report.singleActiveSafe { return .red }
        return report.agentAvailable ? .green : .orange
    }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 13)
                    .fill(statusColor.opacity(0.12))
                if model.isRefreshingMAGI {
                    ProgressView()
                } else {
                    Image(systemName: "brain.head.profile.fill")
                        .font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(statusColor)
                }
            }
            .frame(width: 50, height: 50)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("MAGI AI 助理")
                        .font(.headline)
                    if let report = model.magiStatus {
                        Text(report.activeVersion.displayName)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .foregroundStyle(statusColor)
                            .background(statusColor.opacity(0.12), in: Capsule())
                    }
                }
                Text(model.magiStatus?.summary ?? "正在檢查本機 MAGI…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let compatibility = model.magiStatus?.v3Compatibility, compatibility.found {
                    Text("V3：\(compatibility.releaseID ?? "已找到")・\(compatibility.compatible ? "相容契約通過（未啟動）" : "相容契約待確認")")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            Button("重新檢查") { model.refreshMAGIStatus() }
                .disabled(model.isRefreshingMAGI)
            Button("MAGI 網頁") { model.openMAGIConsole() }
                .disabled(model.magiStatus?.agentAvailable != true)
            if model.analysis != nil {
                Button("立即完整分析") { model.prepareSelectedForMAGI() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.magiStatus?.agentAvailable != true || model.isAnalyzingWithMAGI)
            }
        }
        .padding(16)
        .background(.background.opacity(0.82), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
    }
}

private struct MAGIAnalysisPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var customInstruction = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Label("MAGI 文件分析", systemImage: "sparkles.rectangle.stack.fill")
                    .font(.headline)
                Spacer()
                if model.isAnalyzingWithMAGI {
                    ProgressView()
                        .controlSize(.small)
                    Text("分析中，請稍候…")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else if let result = model.magiAnalysisResult {
                    Text("\(result.reply.compatibilityVersion.uppercased())・\(result.reply.model ?? result.reply.route ?? "MAGI")")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(result.reply.degraded ? .orange : .green)
                }
            }

            TextField("追加要求，例如：請特別檢查日期與金額…", text: $customInstruction)
                .textFieldStyle(.roundedBorder)
                .disabled(model.isAnalyzingWithMAGI)

            HStack(spacing: 9) {
                Button(MAGIAnalysisMode.complete.displayName) {
                    model.analyzeSelectedWithMAGI(mode: .complete, customInstruction: customInstruction)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isAnalyzingWithMAGI || model.magiStatus?.agentAvailable != true)

                ForEach(MAGIAnalysisMode.allCases.filter { $0 != .complete }) { mode in
                    Button(mode.displayName) {
                        model.analyzeSelectedWithMAGI(mode: mode, customInstruction: customInstruction)
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.isAnalyzingWithMAGI || model.magiStatus?.agentAvailable != true)
                }
                Spacer()
                if model.magiAnalysisResult != nil {
                    Button("複製結果") { model.copyMAGIResponse() }
                    Button("清除") { model.clearMAGIResponse() }
                }
            }

            if let error = model.magiAnalysisError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }

            if let result = model.magiAnalysisResult {
                Divider()
                HStack {
                    Text("\(result.mode.displayName)結果")
                        .font(.callout.weight(.bold))
                    Spacer()
                    Text("擷取 \(result.extractedText.text.count) 字\(result.extractedText.truncated ? "（已截取）" : "")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ScrollView {
                    Text(result.reply.text)
                        .font(.body)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
                .frame(minHeight: 150, maxHeight: 360)
                .background(.quaternary.opacity(0.28), in: RoundedRectangle(cornerRadius: 12))
            } else if !model.isAnalyzingWithMAGI {
                Text("選擇分析方式後，結果會直接顯示在這裡，不會再跳到網頁。只有「MAGI 網頁」按鈕會開啟主控台。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(15)
        .background(Color.teal.opacity(0.055), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.teal.opacity(0.2)))
    }
}
