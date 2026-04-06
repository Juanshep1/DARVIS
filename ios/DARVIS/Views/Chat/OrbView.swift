import SwiftUI

enum OrbState {
    case idle, thinking, speaking, listening
}

struct OrbView: View {
    let state: OrbState
    @State private var pulseScale: CGFloat = 1.0
    @State private var floatOffset: CGFloat = 0

    var orbColor: [Color] {
        switch state {
        case .idle: return [Color(red: 0.31, green: 0.71, blue: 1.0), Color(red: 0.12, green: 0.35, blue: 0.78), Color(red: 0.04, green: 0.08, blue: 0.24)]
        case .thinking: return [Color(red: 1.0, green: 0.71, blue: 0.31), Color(red: 0.78, green: 0.39, blue: 0.12), Color(red: 0.24, green: 0.08, blue: 0.04)]
        case .speaking: return [Color(red: 0.31, green: 1.0, blue: 0.63), Color(red: 0.12, green: 0.71, blue: 0.31), Color(red: 0.04, green: 0.16, blue: 0.08)]
        case .listening: return [Color(red: 1.0, green: 0.39, blue: 0.39), Color(red: 0.78, green: 0.16, blue: 0.16), Color(red: 0.24, green: 0.04, blue: 0.04)]
        }
    }

    var glowColor: Color {
        switch state {
        case .idle: return .darvisGlow
        case .thinking: return .darvisOrange
        case .speaking: return .darvisGreen
        case .listening: return .darvisRed
        }
    }

    var pulseSpeed: Double {
        switch state {
        case .idle: return 4.0
        case .thinking: return 0.8
        case .speaking: return 0.35
        case .listening: return 1.0
        }
    }

    var body: some View {
        ZStack {
            // Arc decorations
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .trim(from: CGFloat(i) * 0.15 + 0.05, to: CGFloat(i) * 0.15 + 0.18)
                    .stroke(glowColor.opacity(0.3), lineWidth: 1.5)
                    .frame(width: 220 + CGFloat(i) * 20, height: 220 + CGFloat(i) * 20)
                    .rotationEffect(.degrees(Double(i) * 40 + floatOffset * 10))
            }

            // Main orb
            Circle()
                .fill(
                    RadialGradient(
                        colors: orbColor,
                        center: UnitPoint(x: 0.35, y: 0.35),
                        startRadius: 0,
                        endRadius: 90
                    )
                )
                .frame(width: 180, height: 180)
                .shadow(color: glowColor.opacity(0.4), radius: 30)
                .shadow(color: glowColor.opacity(0.2), radius: 60)
                .scaleEffect(pulseScale)
                .offset(y: floatOffset)

            // Highlight
            Ellipse()
                .fill(RadialGradient(colors: [.white.opacity(0.35), .clear], center: .center, startRadius: 0, endRadius: 30))
                .frame(width: 54, height: 36)
                .offset(x: -18, y: -36)
                .blur(radius: 4)
        }
        .onAppear { startAnimations() }
        .onChange(of: state) { _ in startAnimations() }
    }

    private func startAnimations() {
        withAnimation(.easeInOut(duration: pulseSpeed).repeatForever(autoreverses: true)) {
            pulseScale = state == .speaking ? 1.08 : state == .thinking ? 1.06 : 1.04
        }
        withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
            floatOffset = -8
        }
    }
}
