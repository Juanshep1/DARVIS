import Foundation
import AVFoundation

// Handles mic capture (16kHz PCM) and audio playback (PCM + MP3)
class AudioService: NSObject, ObservableObject {
    private var audioEngine: AVAudioEngine?
    private var audioPlayer: AVAudioPlayer?
    private var pcmPlayerNode: AVAudioPlayerNode?
    private var playbackEngine: AVAudioEngine?

    @Published var isCapturing = false

    var onPCMChunk: ((String) -> Void)? // base64 PCM chunk callback

    // MARK: - Audio Session

    func setupSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try? session.setActive(true)
    }

    // MARK: - Mic Capture (16kHz Int16 PCM → base64)

    func startCapture() {
        setupSession()
        audioEngine = AVAudioEngine()
        guard let engine = audioEngine else { return }

        let inputNode = engine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        let targetRate: Double = 16000

        // Tap at native rate, resample in the callback
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { [weak self] buffer, _ in
            guard let self = self else { return }

            let channelData = buffer.floatChannelData?[0]
            let frameCount = Int(buffer.frameLength)
            guard let samples = channelData, frameCount > 0 else { return }

            // Resample to 16kHz
            let ratio = nativeFormat.sampleRate / targetRate
            let outputCount = Int(Double(frameCount) / ratio)
            var int16Samples = [Int16](repeating: 0, count: outputCount)
            for i in 0..<outputCount {
                let srcIdx = min(Int(Double(i) * ratio), frameCount - 1)
                let val = max(-1.0, min(1.0, samples[srcIdx]))
                int16Samples[i] = Int16(val * 32767)
            }

            // To base64
            let data = int16Samples.withUnsafeBufferPointer { Data(buffer: $0) }
            let b64 = data.base64EncodedString()
            self.onPCMChunk?(b64)
        }

        try? engine.start()
        isCapturing = true
    }

    func stopCapture() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        isCapturing = false
    }

    // MARK: - Play MP3 (ElevenLabs TTS)

    func playMP3(_ data: Data) {
        setupSession()
        audioPlayer = try? AVAudioPlayer(data: data)
        audioPlayer?.play()
    }

    var isPlayingMP3: Bool { audioPlayer?.isPlaying == true }

    func stopMP3() {
        audioPlayer?.stop()
        audioPlayer = nil
    }

    // MARK: - Play PCM (Gemini 24kHz Int16)

    func playPCM(_ data: Data) {
        setupSession()

        // Convert Int16 PCM to AVAudioPCMBuffer
        let sampleRate: Double = 24000
        let sampleCount = data.count / 2
        guard sampleCount > 0 else { return }

        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount)) else { return }
        buffer.frameLength = AVAudioFrameCount(sampleCount)

        let floatData = buffer.floatChannelData![0]
        data.withUnsafeBytes { rawPtr in
            let int16Ptr = rawPtr.bindMemory(to: Int16.self)
            for i in 0..<sampleCount {
                floatData[i] = Float(int16Ptr[i]) / 32768.0
            }
        }

        // Play via AVAudioEngine
        if playbackEngine == nil {
            playbackEngine = AVAudioEngine()
            pcmPlayerNode = AVAudioPlayerNode()
            playbackEngine?.attach(pcmPlayerNode!)
            playbackEngine?.connect(pcmPlayerNode!, to: playbackEngine!.mainMixerNode, format: format)
            try? playbackEngine?.start()
        }
        pcmPlayerNode?.scheduleBuffer(buffer) {}
        pcmPlayerNode?.play()
    }

    func stopPCM() {
        pcmPlayerNode?.stop()
    }

    func stopAll() {
        stopMP3()
        stopPCM()
        stopCapture()
    }
}
