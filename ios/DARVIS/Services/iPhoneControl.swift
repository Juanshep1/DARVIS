import Foundation
import UIKit
import AVFoundation
import MediaPlayer
import CoreLocation
import CoreMotion

// iPhone control actions SPECTRA can perform — Jarvis-level device mastery
class iPhoneControl: NSObject, CLLocationManagerDelegate {
    static let shared = iPhoneControl()

    private let locationManager = CLLocationManager()
    private var locationCompletion: ((CLLocation?) -> Void)?
    private let motionManager = CMMotionManager()

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

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

    // MARK: - Location
    func requestLocation(completion: @escaping (CLLocation?) -> Void) {
        locationCompletion = completion
        locationManager.requestWhenInUseAuthorization()
        locationManager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        locationCompletion?(locations.last)
        locationCompletion = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationCompletion?(nil)
        locationCompletion = nil
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

    // MARK: - Execute control command from SPECTRA
    func execute(_ command: String) -> String {
        let lower = command.lowercased()

        // ── Brightness ──
        if lower.contains("brightness") {
            if let pct = extractNumber(lower) {
                setBrightness(Float(pct) / 100.0)
                return "Brightness set to \(pct)%"
            }
            if lower.contains("max") || lower.contains("full") {
                setBrightness(1.0); return "Brightness set to 100%"
            }
            if lower.contains("low") || lower.contains("dim") || lower.contains("min") {
                setBrightness(0.1); return "Brightness set to 10%"
            }
            return "Current brightness: \(Int(getBrightness() * 100))%"
        }

        // ── Volume ──
        if lower.contains("volume") {
            if let pct = extractNumber(lower) {
                setVolume(Float(pct) / 100.0)
                return "Volume set to \(pct)%"
            }
            if lower.contains("mute") || lower.contains("silent") {
                setVolume(0); return "Volume muted"
            }
            if lower.contains("max") || lower.contains("full") {
                setVolume(1.0); return "Volume set to 100%"
            }
        }

        // ── Flashlight ──
        if lower.contains("flashlight") || lower.contains("torch") {
            if lower.contains("off") { toggleFlashlight(on: false); return "Flashlight off" }
            toggleFlashlight(on: true); return "Flashlight on"
        }

        // ── Clipboard ──
        if lower.contains("clipboard") || lower.contains("paste") {
            if lower.contains("copy") {
                let text = command.replacingOccurrences(of: "copy", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                copyToClipboard(text); return "Copied to clipboard"
            }
            return readClipboard() ?? "Clipboard is empty"
        }

        // ══════════════════════════════════════════════════════════════════
        // MAPS & NAVIGATION — Jarvis-level
        // ══════════════════════════════════════════════════════════════════

        // Directions / Navigate to
        if lower.contains("directions to") || lower.contains("navigate to") || lower.contains("take me to") ||
           lower.contains("drive to") || lower.contains("how to get to") || lower.contains("route to") {
            let dest = extractAfter(lower, triggers: ["directions to", "navigate to", "take me to", "drive to", "how to get to", "route to"])
            if !dest.isEmpty {
                let encoded = dest.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? dest
                // Driving directions
                if lower.contains("walk") || lower.contains("walking") {
                    openURL("maps://?daddr=\(encoded)&dirflg=w")
                    return "Walking directions to \(dest)"
                } else if lower.contains("transit") || lower.contains("bus") || lower.contains("train") || lower.contains("subway") {
                    openURL("maps://?daddr=\(encoded)&dirflg=r")
                    return "Transit directions to \(dest)"
                } else {
                    openURL("maps://?daddr=\(encoded)&dirflg=d")
                    return "Driving directions to \(dest)"
                }
            }
        }

        // Search nearby / Find near me
        if lower.contains("nearby") || lower.contains("near me") || lower.contains("nearest") ||
           lower.contains("find a ") || lower.contains("find an ") || lower.contains("where is the nearest") ||
           lower.contains("where's the nearest") || lower.contains("closest") {
            let query = extractMapQuery(lower)
            if !query.isEmpty {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
                openURL("maps://?q=\(encoded)")
                return "Searching for \(query) nearby"
            }
        }

        // Search a specific location on the map
        if lower.contains("show me") && (lower.contains("on map") || lower.contains("on the map") || lower.contains("map of")) {
            let place = extractAfter(lower, triggers: ["show me", "map of"])
                .replacingOccurrences(of: "on map", with: "")
                .replacingOccurrences(of: "on the map", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !place.isEmpty {
                let encoded = place.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? place
                openURL("maps://?q=\(encoded)")
                return "Showing \(place) on the map"
            }
        }

        // Drop pin / mark location
        if lower.contains("drop a pin") || lower.contains("drop pin") || lower.contains("mark location") ||
           lower.contains("pin this") || lower.contains("save this location") {
            let place = extractAfter(lower, triggers: ["drop a pin at", "drop pin at", "mark location at", "drop a pin", "drop pin"])
            if !place.isEmpty {
                let encoded = place.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? place
                openURL("maps://?q=\(encoded)")
                return "Pinning \(place) on the map"
            }
            // No specific place — open maps to current location
            openURL("maps://?q=Current+Location")
            return "Opening Maps at your current location"
        }

        // ETA / How far / How long to get
        if lower.contains("how far") || lower.contains("how long to get") || lower.contains("eta to") ||
           lower.contains("distance to") || lower.contains("time to get to") {
            let dest = extractAfter(lower, triggers: ["how far is", "how far to", "how long to get to", "eta to", "distance to", "time to get to"])
            if !dest.isEmpty {
                let encoded = dest.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? dest
                openURL("maps://?daddr=\(encoded)&dirflg=d")
                return "Getting ETA to \(dest)"
            }
        }

        // Traffic
        if lower.contains("traffic") {
            let dest = extractAfter(lower, triggers: ["traffic to", "traffic on", "traffic near", "traffic around"])
            if !dest.isEmpty {
                let encoded = dest.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? dest
                openURL("maps://?daddr=\(encoded)&dirflg=d")
                return "Checking traffic to \(dest)"
            }
            openURL("maps://?t=m")
            return "Opening Maps with traffic view"
        }

        // Share location
        if lower.contains("share my location") || lower.contains("send my location") || lower.contains("where am i") {
            openURL("maps://?q=Current+Location")
            return "Showing your current location"
        }

        // Open maps (generic)
        if lower.contains("open maps") || lower.contains("open map") {
            openURL("maps://")
            return "Opening Maps"
        }

        // ══════════════════════════════════════════════════════════════════
        // MUSIC — Multi-app support (Apple Music, Spotify, YouTube Music)
        // ══════════════════════════════════════════════════════════════════

        let player = MPMusicPlayerController.systemMusicPlayer

        // Play on Spotify
        if lower.contains("on spotify") || lower.contains("in spotify") || lower.contains("spotify play") {
            let query = command
                .replacingOccurrences(of: "play ", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "on spotify", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "in spotify", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "spotify play", with: "", options: .caseInsensitive)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
                openURL("spotify:search:\(encoded)")
                return "Searching Spotify for \(query)"
            }
            openURL("spotify://"); return "Opening Spotify"
        }

        // Play on YouTube Music
        if lower.contains("on youtube music") || lower.contains("youtube music") {
            let query = command
                .replacingOccurrences(of: "play ", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "on youtube music", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "youtube music play", with: "", options: .caseInsensitive)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
                openURL("https://music.youtube.com/search?q=\(encoded)")
                return "Searching YouTube Music for \(query)"
            }
            openURL("https://music.youtube.com"); return "Opening YouTube Music"
        }

        // Play on SoundCloud
        if lower.contains("on soundcloud") || lower.contains("soundcloud") {
            let query = command
                .replacingOccurrences(of: "play ", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "on soundcloud", with: "", options: .caseInsensitive)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
                openURL("soundcloud://search?q=\(encoded)")
                return "Searching SoundCloud for \(query)"
            }
            openURL("soundcloud://"); return "Opening SoundCloud"
        }

        // Play on Apple Music (default)
        if lower.contains("play ") && !lower.contains("video") {
            let query = command
                .replacingOccurrences(of: "play ", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "on apple music", with: "", options: .caseInsensitive)
                .replacingOccurrences(of: "in apple music", with: "", options: .caseInsensitive)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
                openURL("music://music.apple.com/search?term=\(encoded)")
                return "Playing \(query)"
            }
        }

        // Music controls — work with whatever app is currently playing
        if lower.contains("pause music") || lower.contains("pause song") || lower.contains("stop music") || lower.contains("stop the music") || lower == "pause" || lower == "stop" {
            player.pause(); return "Music paused"
        }
        if lower.contains("resume music") || lower.contains("resume song") || lower.contains("unpause") || lower == "play" || lower == "resume" {
            player.play(); return "Music resumed"
        }
        if lower.contains("next song") || lower.contains("next track") || lower.contains("skip song") || lower.contains("skip track") || lower == "skip" || lower == "next" {
            player.skipToNextItem(); return "Skipped to next track"
        }
        if lower.contains("previous song") || lower.contains("previous track") || lower.contains("last song") || lower.contains("go back") || lower == "previous" || lower == "back" {
            player.skipToPreviousItem(); return "Back to previous track"
        }
        if lower.contains("what's playing") || lower.contains("what song") || lower.contains("now playing") || lower.contains("current song") || lower.contains("what is this song") {
            if let item = player.nowPlayingItem {
                let title = item.title ?? "Unknown"
                let artist = item.artist ?? "Unknown"
                let album = item.albumTitle ?? ""
                return "Now playing: \(title) by \(artist)" + (album.isEmpty ? "" : " (\(album))")
            }
            return "Nothing is playing right now"
        }
        if lower.contains("shuffle") {
            if lower.contains("off") {
                player.shuffleMode = .off; return "Shuffle off"
            }
            player.shuffleMode = .songs; return "Shuffle on"
        }
        if lower.contains("repeat") {
            if lower.contains("off") || lower.contains("none") {
                player.repeatMode = .none; return "Repeat off"
            }
            if lower.contains("one") || lower.contains("song") || lower.contains("track") {
                player.repeatMode = .one; return "Repeating current track"
            }
            player.repeatMode = .all; return "Repeat all on"
        }

        // Open music apps
        if lower.contains("open music") { openURL("music://"); return "Opening Apple Music" }
        if lower.contains("open spotify") { openURL("spotify://"); return "Opening Spotify" }

        // ══════════════════════════════════════════════════════════════════
        // APP LAUNCHING
        // ══════════════════════════════════════════════════════════════════

        if lower.contains("open settings") { openSettings(); return "Opening Settings" }
        if lower.contains("open safari") { openURL("https://"); return "Opening Safari" }
        if lower.contains("open messages") || lower.contains("open texts") { openURL("sms://"); return "Opening Messages" }
        if lower.contains("open phone") || lower.contains("open dialer") { openURL("tel://"); return "Opening Phone" }
        if lower.contains("open mail") || lower.contains("open email") { openURL("mailto://"); return "Opening Mail" }
        if lower.contains("open camera") { openURL("camera://"); return "Opening Camera" }
        if lower.contains("open photos") || lower.contains("open gallery") { openURL("photos-redirect://"); return "Opening Photos" }
        if lower.contains("open calendar") { openURL("calshow://"); return "Opening Calendar" }
        if lower.contains("open notes") { openURL("mobilenotes://"); return "Opening Notes" }
        if lower.contains("open reminders") { openURL("x-apple-reminderkit://"); return "Opening Reminders" }
        if lower.contains("open clock") || lower.contains("open timer") || lower.contains("open alarm") { openURL("clock://"); return "Opening Clock" }
        if lower.contains("open weather") { openURL("weather://"); return "Opening Weather" }
        if lower.contains("open wallet") || lower.contains("open apple pay") { openURL("shoebox://"); return "Opening Wallet" }
        if lower.contains("open facetime") { openURL("facetime://"); return "Opening FaceTime" }
        if lower.contains("open files") { openURL("shareddocuments://"); return "Opening Files" }
        if lower.contains("open shortcuts") { openURL("shortcuts://"); return "Opening Shortcuts" }
        if lower.contains("open health") { openURL("x-apple-health://"); return "Opening Health" }
        if lower.contains("open app store") { openURL("itms-apps://"); return "Opening App Store" }
        if lower.contains("open youtube") { openURL("youtube://"); return "Opening YouTube" }
        if lower.contains("open instagram") { openURL("instagram://"); return "Opening Instagram" }
        if lower.contains("open twitter") || lower.contains("open x app") { openURL("twitter://"); return "Opening Twitter/X" }
        if lower.contains("open tiktok") { openURL("snssdk1233://"); return "Opening TikTok" }
        if lower.contains("open whatsapp") { openURL("whatsapp://"); return "Opening WhatsApp" }
        if lower.contains("open snapchat") { openURL("snapchat://"); return "Opening Snapchat" }
        if lower.contains("open telegram") { openURL("tg://"); return "Opening Telegram" }
        if lower.contains("open discord") { openURL("discord://"); return "Opening Discord" }
        if lower.contains("open reddit") { openURL("reddit://"); return "Opening Reddit" }
        if lower.contains("open netflix") { openURL("nflx://"); return "Opening Netflix" }
        if lower.contains("open amazon") { openURL("com.amazon.mobile.shopping://"); return "Opening Amazon" }
        if lower.contains("open uber") { openURL("uber://"); return "Opening Uber" }
        if lower.contains("open lyft") { openURL("lyft://"); return "Opening Lyft" }
        if lower.contains("open doordash") { openURL("doordash://"); return "Opening DoorDash" }

        // ══════════════════════════════════════════════════════════════════
        // COMMUNICATION
        // ══════════════════════════════════════════════════════════════════

        // Call someone
        if lower.contains("call ") {
            let contact = extractAfter(lower, triggers: ["call"])
            if !contact.isEmpty {
                let encoded = contact.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? contact
                openURL("tel://\(encoded)")
                return "Calling \(contact)"
            }
        }

        // Text someone
        if lower.contains("text ") || lower.contains("message ") {
            let contact = extractAfter(lower, triggers: ["text", "message"])
            if !contact.isEmpty {
                let encoded = contact.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? contact
                openURL("sms://\(encoded)")
                return "Opening message to \(contact)"
            }
        }

        // FaceTime someone
        if lower.contains("facetime ") {
            let contact = extractAfter(lower, triggers: ["facetime"])
            if !contact.isEmpty {
                let encoded = contact.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? contact
                openURL("facetime://\(encoded)")
                return "FaceTiming \(contact)"
            }
        }

        // ══════════════════════════════════════════════════════════════════
        // TIMERS & ALARMS
        // ══════════════════════════════════════════════════════════════════

        if lower.contains("set a timer") || lower.contains("set timer") || lower.contains("start a timer") {
            if let mins = extractNumber(lower) {
                let secs = mins * 60
                openURL("clock://timer?duration=\(secs)")
                return "Setting a \(mins) minute timer"
            }
            openURL("clock://timer")
            return "Opening timer"
        }

        if lower.contains("set an alarm") || lower.contains("set alarm") {
            openURL("clock://alarm")
            return "Opening alarms"
        }

        if lower.contains("stopwatch") {
            openURL("clock://stopwatch")
            return "Opening stopwatch"
        }

        // ── Do Not Disturb ──
        if lower.contains("do not disturb") || lower.contains("dnd") || lower.contains("focus mode") {
            openURL("App-prefs:FOCUS")
            return "Opening Focus settings"
        }

        // ── Wi-Fi / Bluetooth settings ──
        if lower.contains("wifi settings") || lower.contains("wi-fi settings") {
            openURL("App-prefs:WIFI")
            return "Opening Wi-Fi settings"
        }
        if lower.contains("bluetooth settings") {
            openURL("App-prefs:Bluetooth")
            return "Opening Bluetooth settings"
        }

        // ── Device info ──
        if lower.contains("device info") || lower.contains("phone info") || lower.contains("battery") {
            let info = getDeviceInfo()
            return info.map { "\($0.key): \($0.value)" }.joined(separator: ", ")
        }

        return "Unknown control command"
    }

    // MARK: - Helpers

    private func extractNumber(_ text: String) -> Int? {
        let numbers = text.components(separatedBy: CharacterSet.decimalDigits.inverted).compactMap { Int($0) }
        return numbers.first
    }

    private func extractAfter(_ text: String, triggers: [String]) -> String {
        for trigger in triggers {
            if let range = text.range(of: trigger) {
                let after = text[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
                if !after.isEmpty { return after }
            }
        }
        return ""
    }

    private func extractMapQuery(_ text: String) -> String {
        let stripWords = ["nearby", "near me", "nearest", "closest", "find a", "find an",
                          "find the nearest", "find the closest", "where is the nearest",
                          "where's the nearest", "where is the closest", "show me", "find me a", "find me"]
        var result = text
        for word in stripWords {
            result = result.replacingOccurrences(of: word, with: "")
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
