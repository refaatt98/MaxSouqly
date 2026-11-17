import UIKit
import WebKit

/// MAX Management: the web app (maxsouqly.netlify.app) in a full-screen web view.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let home = URL(string: "https://maxsouqly.netlify.app/")!
    static let host = "maxsouqly.netlify.app"
    static let background = UIColor(red: 19 / 255, green: 17 / 255, blue: 16 / 255, alpha: 1)

    private var web: WKWebView!
    private let refresh = UIRefreshControl()

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "MaxManagementApp/1.0 (iOS)"
        // the web app hands printing and file saving to the app (src/lib/native.ts)
        let controller = WKUserContentController()
        controller.add(WeakHandler(self), name: "maxPrint")
        controller.add(WeakHandler(self), name: "maxSave")
        config.userContentController = controller

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.scrollView.contentInsetAdjustmentBehavior = .never
        refresh.tintColor = .white
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        web.scrollView.refreshControl = refresh

        let root = UIView()
        root.backgroundColor = Self.background
        root.addSubview(web)
        web.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: Self.home))
    }

    @objc private func reload() {
        if web.url == nil || web.url?.isFileURL == true { web.load(URLRequest(url: Self.home)) } else { web.reload() }
    }

    private static func isOurs(_ url: URL?) -> Bool {
        url?.scheme == "https" && url?.host == host
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme ?? ""
        if Self.isOurs(url) || ["about", "blob", "data", "file"].contains(scheme) {
            return decisionHandler(.allow)
        }
        // only links the person taps leave the app (phone numbers, WhatsApp, maps, other sites)
        if action.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    /// target=_blank / window.open: open in the same view (or outside for other sites)
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if Self.isOurs(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refresh.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refresh.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        refresh.endRefreshing()
        if (error as NSError).code == NSURLErrorCancelled { return }
        showOffline()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showOffline() {
        guard let file = Bundle.main.url(forResource: "offline", withExtension: "html") else { return }
        web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    // MARK: alert / confirm / prompt from the page

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    // MARK: messages from the web app

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard Self.isOurs(message.frameInfo.request.url) || Self.isOurs(web.url),
              let body = message.body as? [String: Any] else { return }
        switch message.name {
        case "maxPrint":
            print(html: body["html"] as? String ?? "", title: body["title"] as? String ?? "MAX")
        case "maxSave":
            save(name: body["name"] as? String ?? "max.csv", base64: body["base64"] as? String ?? "")
        default:
            break
        }
    }

    private var printer: PrintLoader?

    private func print(html: String, title: String) {
        // render the receipt / report in an off-screen web view so it prints exactly as designed
        let loader = PrintLoader(html: html) { [weak self] formatter in
            guard let self else { return }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = title
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printFormatter = formatter
            let done: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, _ in self?.printer = nil }
            if UIDevice.current.userInterfaceIdiom == .pad {
                pc.present(from: CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1), in: self.view, animated: true, completionHandler: done)
            } else {
                pc.present(animated: true, completionHandler: done)
            }
        }
        printer = loader
        loader.start()
    }

    private func save(name: String, base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do { try data.write(to: url, options: .atomic) } catch { return }
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(share, animated: true)
    }
}

/// Loads printable HTML off screen and hands back its print formatter once fonts and images are in.
private final class PrintLoader: NSObject, WKNavigationDelegate {
    private let html: String
    private let ready: (UIPrintFormatter) -> Void
    private let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 1100))
    private var fired = false

    init(html: String, ready: @escaping (UIPrintFormatter) -> Void) {
        self.html = html
        self.ready = ready
        super.init()
        web.navigationDelegate = self
    }

    func start() {
        web.loadHTMLString(html, baseURL: WebViewController.home)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !fired else { return }
        fired = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [self] in ready(web.viewPrintFormatter()) }
    }
}

/// Avoids a retain cycle between the content controller and the view controller.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}
