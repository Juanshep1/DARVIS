import Foundation
import AVFoundation
import UIKit
import SwiftUI

class CameraService: NSObject, ObservableObject {
    @Published var isActive = false
    @Published var previewImage: UIImage?

    private var captureSession: AVCaptureSession?
    private var lastFrameData: Data?  // Store JPEG data directly
    private let sessionQueue = DispatchQueue(label: "com.darvis.camera.session")
    private var frameSkip = 0

    func start() {
        guard !isActive else { return }

        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted { self?.sessionQueue.async { self?.setup() } }
            }
        } else if status == .authorized {
            sessionQueue.async { self.setup() }
        }
    }

    private func setup() {
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .medium

        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
              let input = try? AVCaptureDeviceInput(device: cam),
              session.canAddInput(input) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "com.darvis.camera.output", qos: .utility))

        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            return
        }
        session.addOutput(output)

        if let conn = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
            } else {
                if conn.isVideoOrientationSupported { conn.videoOrientation = .portrait }
            }
        }

        session.commitConfiguration()
        captureSession = session
        session.startRunning()
        DispatchQueue.main.async { self.isActive = true }
    }

    func stop() {
        let s = captureSession
        captureSession = nil
        sessionQueue.async { s?.stopRunning() }
        DispatchQueue.main.async {
            self.isActive = false
            self.previewImage = nil
            self.lastFrameData = nil
        }
    }

    func captureFrame() -> String? {
        guard let data = lastFrameData else { return nil }
        return data.base64EncodedString()
    }
}

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameSkip += 1

        // Process every 6th frame (~5fps) to keep things smooth
        guard frameSkip % 6 == 0 else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let uiImage = UIImage(ciImage: ciImage)

        // Store as JPEG for capture
        let jpegData = uiImage.jpegData(compressionQuality: 0.7)
        lastFrameData = jpegData

        // Update preview
        DispatchQueue.main.async { [weak self] in
            self?.previewImage = uiImage
        }
    }
}

struct CameraPreviewView: View {
    @ObservedObject var camera: CameraService

    var body: some View {
        if let image = camera.previewImage {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            Color.black.overlay(
                ProgressView().tint(Color(red: 0.29, green: 0.56, blue: 0.85))
            )
        }
    }
}
