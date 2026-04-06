import Foundation
import AVFoundation
import UIKit
import SwiftUI

// Camera frame capture + live preview for vision analysis
class CameraService: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    @Published var isActive = false
    @Published var previewImage: UIImage?

    private var captureSession: AVCaptureSession?
    private var lastFrame: UIImage?
    private let queue = DispatchQueue(label: "camera", qos: .userInteractive)
    private let ciContext = CIContext() // Reuse — expensive to create
    private var frameCount = 0

    func start() {
        guard !isActive else { return }

        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard granted else {
                DispatchQueue.main.async { self?.isActive = false }
                return
            }
            DispatchQueue.main.async { self?.setupSession() }
        }
    }

    private func setupSession() {
        captureSession = AVCaptureSession()
        captureSession?.sessionPreset = .hd1280x720

        // Try rear camera, fall back to front
        let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)

        guard let cam = camera, let input = try? AVCaptureDeviceInput(device: cam) else { return }
        captureSession?.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        captureSession?.addOutput(output)

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

        queue.async { [weak self] in
            self?.captureSession?.startRunning()
        }
        isActive = true
    }

    func stop() {
        queue.async { [weak self] in
            self?.captureSession?.stopRunning()
        }
        captureSession = nil
        isActive = false
        lastFrame = nil
        DispatchQueue.main.async { self.previewImage = nil }
    }

    func captureFrame() -> String? {
        guard let image = lastFrame else { return nil }
        guard let jpegData = image.jpegData(compressionQuality: 0.85) else { return nil }
        return jpegData.base64EncodedString()
    }

    // Delegate — process every 3rd frame (~10fps preview) to save CPU
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameCount += 1
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }
        let uiImage = UIImage(cgImage: cgImage)

        // Always update lastFrame for capture
        lastFrame = uiImage

        // Update preview at ~10fps
        if frameCount % 3 == 0 {
            DispatchQueue.main.async { [weak self] in
                self?.previewImage = uiImage
            }
        }
    }
}

// SwiftUI wrapper for camera preview
struct CameraPreviewView: View {
    @ObservedObject var camera: CameraService

    var body: some View {
        Group {
            if let image = camera.previewImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.black
                    .overlay(
                        ProgressView()
                            .tint(.darvisCyan)
                    )
            }
        }
    }
}
