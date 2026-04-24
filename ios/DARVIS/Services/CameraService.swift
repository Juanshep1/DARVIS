import Foundation
import AVFoundation
import UIKit
import SwiftUI
import CoreImage

class CameraService: NSObject, ObservableObject {
    @Published var isActive = false

    let captureSession = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.spectra.camera")
    private var photoOutput = AVCapturePhotoOutput()

    // Keep the raw CIImage — UIImage(ciImage:) has no cgImage backing, so
    // jpegData(compressionQuality:) returns nil. Render through CIContext
    // in captureFrame() instead.
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let frameLock = NSLock()
    private var lastCIImage: CIImage?

    func start() {
        guard !isActive else { return }

        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            sessionQueue.async { self.configure() }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { self.sessionQueue.async { self.configure() } }
            }
        default:
            break
        }
    }

    private func configure() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .photo

        // Input
        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
              let input = try? AVCaptureDeviceInput(device: cam),
              captureSession.canAddInput(input) else {
            captureSession.commitConfiguration()
            return
        }
        captureSession.addInput(input)

        // Photo output for frame capture
        if captureSession.canAddOutput(photoOutput) {
            captureSession.addOutput(photoOutput)
        }

        // Video output for frame grab
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: DispatchQueue(label: "com.spectra.camera.frames", qos: .utility))
        if captureSession.canAddOutput(videoOutput) {
            captureSession.addOutput(videoOutput)
            if let conn = videoOutput.connection(with: .video) {
                if #available(iOS 17.0, *) {
                    if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
                } else {
                    if conn.isVideoOrientationSupported { conn.videoOrientation = .portrait }
                }
            }
        }

        captureSession.commitConfiguration()
        captureSession.startRunning()

        DispatchQueue.main.async { self.isActive = true }
    }

    func stop() {
        sessionQueue.async {
            self.captureSession.stopRunning()
            // Remove all inputs/outputs so it can be reconfigured
            for input in self.captureSession.inputs { self.captureSession.removeInput(input) }
            for output in self.captureSession.outputs { self.captureSession.removeOutput(output) }
        }
        DispatchQueue.main.async { self.isActive = false }
        frameLock.lock(); lastCIImage = nil; frameLock.unlock()
    }

    /// Capture current frame as base64 JPEG for vision API
    func captureFrame() -> String? {
        frameLock.lock()
        let ciImage = lastCIImage
        frameLock.unlock()
        guard let ciImage = ciImage else {
            NSLog("[CameraService] captureFrame: no frame yet")
            return nil
        }
        // Always render to sRGB — the source pixel buffer is usually
        // YCbCr, and jpegRepresentation returns nil for non-RGB spaces.
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let jpeg = ciContext.jpegRepresentation(of: ciImage,
                                                      colorSpace: colorSpace,
                                                      options: [:]) else {
            NSLog("[CameraService] jpegRepresentation nil (extent: \(ciImage.extent))")
            return nil
        }
        NSLog("[CameraService] captured frame: \(jpeg.count) bytes")
        return jpeg.base64EncodedString()
    }
}

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        frameLock.lock()
        lastCIImage = ciImage
        frameLock.unlock()
    }
}

// MARK: - Live Preview using AVCaptureVideoPreviewLayer (Apple's recommended way)

struct CameraPreviewView: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> CameraUIView {
        let view = CameraUIView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: CameraUIView, context: Context) {
        uiView.previewLayer.session = session
    }
}

class CameraUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
