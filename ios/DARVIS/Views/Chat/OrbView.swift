import SwiftUI

enum OrbState {
    case idle, thinking, speaking, listening
}

struct OrbView: View {
    let state: OrbState
    @State private var animate = false

    var colors: [Color] {
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

    var pulseScale: CGFloat { animate ? (state == .speaking ? 1.08 : state == .thinking ? 1.06 : 1.04) : 1.0 }
    var floatY: CGFloat { animate ? -6 : 0 }

    var body: some View {
        ZStack {
            // Arcs
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .trim(from: CGFloat(i) * 0.15 + 0.05, to: CGFloat(i) * 0.15 + 0.18)
                    .stroke(glowColor.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 210 + CGFloat(i) * 18, height: 210 + CGFloat(i) * 18)
                    .rotationEffect(.degrees(animate ? Double(i) * 40 + 20 : Double(i) * 40))
            }

            // Orb
            Circle()
                .fill(RadialGradient(colors: colors, center: UnitPoint(x: 0.35, y: 0.35), startRadius: 0, endRadius: 85))
                .frame(width: 170, height: 170)
                .shadow(color: glowColor.opacity(0.4), radius: 25)
                .shadow(color: glowColor.opacity(0.15), radius: 50)
                .scaleEffect(pulseScale)
                .offset(y: floatY)

            // Highlight
            Ellipse()
                .fill(RadialGradient(colors: [.white.opacity(0.3), .clear], center: .center, startRadius: 0, endRadius: 25))
                .frame(width: 50, height: 32)
                .offset(x: -16, y: -34)
                .blur(radius: 3)
                .offset(y: floatY)
        }
        .animation(.easeInOut(duration: state == .speaking ? 0.4 : state == .thinking ? 0.8 : 3.0).repeatForever(autoreverses: true), value: animate)
        .onAppear { animate = true }
    }
}
