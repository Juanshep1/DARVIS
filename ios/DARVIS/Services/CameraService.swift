import Foundation
import AVFoundation
import UIKit
import SwiftUI

class CameraService: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    @Published var isActive = false
    @Published var previewImage: UIImage?

    private var captureSession: AVCaptureSession?
    private var lastFrame: UIImage?
    private let queue = DispatchQueue(label: "camera", qos: .userInteractive)
    private let ciContext = CIContext()
    private var frameCount = 0

    func start() {
        guard !isActive else { return }

        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard granted else { return }
            DispatchQueue.main.async { self?.setupSession() }
        }
    }

    private func setupSession() {
        // Configure audio session to allow both camera and mic
        let audioSession = AVAudioSession.sharedInstance()
        try? audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try? audioSession.setActive(true)

        captureSession = AVCaptureSession()
        captureSession?.sessionPreset = .hd1280x720

        let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)

        guard let cam = camera, let input = try? AVCaptureDeviceInput(device: cam) else { return }

        if captureSession?.canAddInput(input) == true {
            captureSession?.addInput(input)
        }

        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true

        if captureSession?.canAddOutput(output) == true {
            captureSession?.addOutput(output)
        }

        // Fix orientation
        if let connection = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
            } else {
                if connection.isVideoOrientationSupported {
                    connection.videoOrientation = .portrait
                }
            }
        }

        isActive = true

        queue.async { [weak self] in
            self?.captureSession?.startRunning()
        }
    }

    func stop() {
        let session = captureSession
        captureSession = nil

        queue.async {
            session?.stopRunning()
        }

        DispatchQueue.main.async {
            self.isActive = false
            self.lastFrame = nil
            self.previewImage = nil
        }
    }

    func captureFrame() -> String? {
        guard let image = lastFrame else { return nil }
        guard let jpegData = image.jpegData(compressionQuality: 0.85) else { return nil }
        return jpegData.base64EncodedString()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }
        let uiImage = UIImage(cgImage: cgImage)

        lastFrame = uiImage

        frameCount += 1
        if frameCount % 3 == 0 {
            DispatchQueue.main.async { [weak self] in
                self?.previewImage = uiImage
            }
        }
    }
}

struct CameraPreviewView: View {
    @ObservedObject var camera: CameraService

    var body: some View {
        Group {
            if let image = camera.previewImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if camera.isActive {
                Color.black
                    .overlay(ProgressView().tint(.darvisCyan))
            } else {
                Color.black
            }
        }
    }
}
