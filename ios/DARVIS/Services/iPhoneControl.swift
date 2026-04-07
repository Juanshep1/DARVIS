import Foundation
import UIKit
import AVFoundation
import MediaPlayer

// iPhone control actions DARVIS can perform
class iPhoneControl {
    static let shared = iPhoneControl()

    // MARK: - Brightness
    func setBrightness(_ level: Float) {
        DispatchQueue.main.async {
            UIScreen.main.brightness = CGFloat(max(0, min(1, level)))
        }
    }

    func getBrightness() -> Float {
        Float(UIScreen.main.brightness)
    }

    // MARK: - Volume
    func setVolume(_ level: Float) {
        let volumeView = MPVolumeView()
        if let slider = volumeView.subviews.first(where: { $0 is UISlider }) as? UISlider {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                slider.value = max(0, min(1, level))
            }
        }
    }

    // MARK: - Flashlight
    func toggleFlashlight(on: Bool) {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return }
        try? device.lockForConfiguration()
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
    }

    // MARK: - Haptic Feedback
    func haptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    // MARK: - Open App/URL
    func openURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
        }
    }

    func openSettings() {
        openURL(UIApplication.openSettingsURLString)
    }

    // MARK: - Clipboard
    func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
    }

    func readClipboard() -> String? {
        UIPasteboard.general.string
    }

    // MARK: - Device Info
    func getDeviceInfo() -> [String: String] {
        let device = UIDevice.current
        let battery = device.batteryLevel
        device.isBatteryMonitoringEnabled = true
        return [
            "name": device.name,
            "model": device.model,
            "os": "\(device.systemName) \(device.systemVersion)",
            "battery": battery >= 0 ? "\(Int(battery * 100))%" : "unknown",
            "charging": device.batteryState == .charging || device.batteryState == .full ? "yes" : "no",
            "brightness": "\(Int(getBrightness() * 100))%",
        ]
    }

    // MARK: - Execute control command from DARVIS
    func execute(_ command: String) -> String {
        let lower = command.lowercased()

        // Brightness
        if lower.contains("brightness") {
            if let pct = extractNumber(lower) {
                setBrightness(Float(pct) / 100.0)
                return "Brightness set to \(pct)%"
            }
            if lower.contains("max") || lower.contains("full") {
                setBrightness(1.0)
                return "Brightness set to 100%"
            }
            if lower.contains("low") || lower.contains("dim") || lower.contains("min") {
                setBrightness(0.1)
                return "Brightness set to 10%"
            }
            return "Current brightness: \(Int(getBrightness() * 100))%"
        }

        // Volume
        if lower.contains("volume") {
            if let pct = extractNumber(lower) {
                setVolume(Float(pct) / 100.0)
                return "Volume set to \(pct)%"
            }
            if lower.contains("mute") || lower.contains("silent") {
                setVolume(0)
                return "Volume muted"
            }
            if lower.contains("max") || lower.contains("full") {
                setVolume(1.0)
                return "Volume set to 100%"
            }
        }

        // Flashlight
        if lower.contains("flashlight") || lower.contains("torch") {
            if lower.contains("off") {
                toggleFlashlight(on: false)
                return "Flashlight off"
            }
            toggleFlashlight(on: true)
            return "Flashlight on"
        }

        // Clipboard
        if lower.contains("clipboard") || lower.contains("paste") {
            if lower.contains("copy") {
                let text = command.replacingOccurrences(of: "copy", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                copyToClipboard(text)
                return "Copied to clipboard"
            }
            return readClipboard() ?? "Clipboard is empty"
        }

        // Open apps
        if lower.contains("open settings") { openSettings(); return "Opening Settings" }
        if lower.contains("open safari") { openURL("https://"); return "Opening Safari" }
        if lower.contains("open maps") { openURL("maps://"); return "Opening Maps" }
        if lower.contains("open messages") { openURL("sms://"); return "Opening Messages" }
        if lower.contains("open phone") { openURL("tel://"); return "Opening Phone" }
        if lower.contains("open mail") { openURL("mailto://"); return "Opening Mail" }
        if lower.contains("open camera") { openURL("camera://"); return "Opening Camera" }
        if lower.contains("open music") { openURL("music://"); return "Opening Music" }
        if lower.contains("open photos") { openURL("photos-redirect://"); return "Opening Photos" }

        // Device info
        if lower.contains("device info") || lower.contains("phone info") || lower.contains("battery") {
            let info = getDeviceInfo()
            return info.map { "\($0.key): \($0.value)" }.joined(separator: ", ")
        }

        return "Unknown control command"
    }

    private func extractNumber(_ text: String) -> Int? {
        let numbers = text.components(separatedBy: CharacterSet.decimalDigits.inverted).compactMap { Int($0) }
        return numbers.first
    }
}
