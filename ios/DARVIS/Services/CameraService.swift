import Foundation
import AVFoundation
import UIKit

// Camera frame capture for vision analysis
class CameraService: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    @Published var isActive = false
    @Published var previewImage: UIImage?

    private var captureSession: AVCaptureSession?
    private var lastFrame: UIImage?
    private let queue = DispatchQueue(label: "camera")

    func start() {
        guard !isActive else { return }

        captureSession = AVCaptureSession()
        captureSession?.sessionPreset = .hd1280x720

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera) else { return }

        captureSession?.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        captureSession?.addOutput(output)

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
        previewImage = nil
    }

    // Capture a single frame as base64 JPEG
    func captureFrame() -> String? {
        guard let image = lastFrame else { return nil }
        guard let jpegData = image.jpegData(compressionQuality: 0.85) else { return nil }
        return jpegData.base64EncodedString()
    }

    // AVCaptureVideoDataOutputSampleBufferDelegate
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
        let uiImage = UIImage(cgImage: cgImage)

        lastFrame = uiImage
        // Update preview at ~5fps to save CPU
        DispatchQueue.main.async { [weak self] in
            self?.previewImage = uiImage
        }
    }
}
