import Foundation
import AVFoundation
import UIKit
import SwiftUI

class CameraService: NSObject, ObservableObject {
    @Published var isActive = false
    @Published var previewImage: UIImage?

    private var captureSession: AVCaptureSession?
    private var lastFrame: UIImage?
    private let sessionQueue = DispatchQueue(label: "com.darvis.camera.session")
    private let ciContext = CIContext()
    private var frameCount = 0
    private var output: AVCaptureVideoDataOutput?

    func start() {
        guard !isActive else { return }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            sessionQueue.async { self.configureAndStart() }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    self?.sessionQueue.async { self?.configureAndStart() }
                } else {
                    DispatchQueue.main.async {
                        self?.isActive = false
                    }
                }
            }
        default:
            DispatchQueue.main.async { self.isActive = false }
        }
    }

    private func configureAndStart() {
        let session = AVCaptureSession()

        session.beginConfiguration()
        session.sessionPreset = .medium  // Safer than hd1280x720 on all devices

        // Get camera
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        else {
            session.commitConfiguration()
            return
        }

        // Add input
        guard let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)

        // Add output
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: DispatchQueue(label: "com.darvis.camera.frames"))

        guard session.canAddOutput(videoOutput) else {
            session.commitConfiguration()
            return
        }
        session.addOutput(videoOutput)

        // Fix orientation
        if let connection = videoOutput.connection(with: .video) {
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

        session.commitConfiguration()

        self.captureSession = session
        self.output = videoOutput

        // Start on session queue
        session.startRunning()

        DispatchQueue.main.async {
            self.isActive = true
        }
    }

    func stop() {
        let session = captureSession
        captureSession = nil
        output = nil

        sessionQueue.async {
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
        guard let jpegData = image.jpegData(compressionQuality: 0.8) else { return nil }
        return jpegData.base64EncodedString()
    }
}

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }
        let image = UIImage(cgImage: cgImage)

        lastFrame = image

        frameCount += 1
        if frameCount % 5 == 0 {  // ~6fps preview
            DispatchQueue.main.async { [weak self] in
                self?.previewImage = image
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
                    .overlay(
                        VStack(spacing: 8) {
                            ProgressView().tint(.darvisCyan)
                            Text("Starting camera...")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(.darvisDim)
                        }
                    )
            } else {
                Color.black
            }
        }
    }
}
