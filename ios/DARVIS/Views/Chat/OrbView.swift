import SwiftUI

enum OrbState {
    case idle, thinking, speaking, listening
}

// Precomputed node data (consistent across frames)
private struct SphereNode {
    let ox: Double, oy: Double, oz: Double
    let pulse: Double
    let size: Double
}

private let sphereNodes: [SphereNode] = {
    let count = 120
    let goldenAngle = Double.pi * (3 - sqrt(5))
    var nodes: [SphereNode] = []
    // Simple seeded PRNG
    var s: UInt64 = 12345
    func rand() -> Double {
        s = s &* 6364136223846793005 &+ 1442695040888963407
        return Double(UInt32(truncatingIfNeeded: s >> 33)) / Double(UInt32.max)
    }
    for i in 0..<count {
        let y = 1 - (Double(i) / Double(count - 1)) * 2
        let r = sqrt(1 - y * y)
        let theta = goldenAngle * Double(i)
        nodes.append(SphereNode(
            ox: cos(theta) * r, oy: y, oz: sin(theta) * r,
            pulse: rand() * Double.pi * 2,
            size: 1.5 + rand() * 2.0
        ))
    }
    return nodes
}()

struct OrbView: View {
    let state: OrbState
    @State private var startDate = Date()
    @State private var speakIntensity: Double = 0

    // Almanac-warm orb colors: gilt idle, amber thinking, gilt speaking, rubric listening
    var stateColor: (r: Double, g: Double, b: Double) {
        switch state {
        case .idle:      return (0.831, 0.659, 0.278) // gilt #d4a847
        case .thinking:  return (1.0, 0.71, 0.31)     // warm amber
        case .speaking:  return (0.925, 0.882, 0.776) // ink cream
        case .listening: return (0.890, 0.322, 0.322) // rubric red
        }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let elapsed = timeline.date.timeIntervalSince(startDate)
            let phase = elapsed * 0.5
            let si = state == .speaking ? max(speakIntensity, 0.5) : speakIntensity * 0.97

            Canvas { context, size in
                drawOrb(context: &context, size: size, phase: phase, speakIntensity: si)
            }
            .onChange(of: elapsed) {
                // Decay speak intensity each frame
                if state == .speaking {
                    speakIntensity = max(speakIntensity, 0.5)
                } else {
                    speakIntensity *= 0.97
                }
            }
        }
        .frame(width: 300, height: 300)
        .onChange(of: state) { _, newState in
            if newState == .speaking { speakIntensity = 1.0 }
        }
    }

    private func drawOrb(context: inout GraphicsContext, size: CGSize, phase: Double, speakIntensity: Double) {
        let cx = size.width / 2
        let cy = size.height / 2
        let radius = min(size.width, size.height) * 0.36
        let connectionDist = radius * 0.6
        let tc = stateColor

        // Center glow
        let glowR = radius * 0.6
        for i in stride(from: 10, through: 1, by: -1) {
            let frac = Double(i) / 10.0
            let s = glowR * frac
            let a = (0.06 + speakIntensity * 0.08) * (1 - frac)
            context.fill(
                Path(ellipseIn: CGRect(x: cx - s, y: cy - s, width: s * 2, height: s * 2)),
                with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: a))
            )
        }

        // Rotation
        let rotY = phase
        let rotX = sin(phase * 0.6) * 0.3
        let cosY = cos(rotY), sinY = sin(rotY)
        let cosX = cos(rotX), sinX = sin(rotX)
        let time = phase * 4

        // Project nodes
        struct Proj {
            let sx: Double, sy: Double, depth: Double, pulse: Double, scale: Double, size: Double
        }

        var projected: [Proj] = []
        projected.reserveCapacity(sphereNodes.count)

        for n in sphereNodes {
            let x1 = n.ox * cosY - n.oz * sinY
            let z1 = n.ox * sinY + n.oz * cosY
            let y1 = n.oy * cosX - z1 * sinX
            let z2 = n.oy * sinX + z1 * cosX

            let dist = 1 + speakIntensity * (0.15 + sin(n.pulse + phase * 5) * 0.1)
            let scale = 1 / (1 + z2 * 0.3)
            projected.append(Proj(
                sx: cx + x1 * radius * scale * dist,
                sy: cy + y1 * radius * scale * dist,
                depth: z2, pulse: n.pulse, scale: scale, size: n.size
            ))
        }

        projected.sort { $0.depth < $1.depth }

        // Connections
        for i in 0..<projected.count {
            for j in (i + 1)..<projected.count {
                let a = projected[i], b = projected[j]
                let dx = a.sx - b.sx, dy = a.sy - b.sy
                let d = sqrt(dx * dx + dy * dy)
                if d < connectionDist {
                    let depthF = (a.depth + b.depth + 2) / 4
                    let alpha = (1 - d / connectionDist) * 0.3 * max(0, depthF)
                    if alpha > 0.01 {
                        var path = Path()
                        path.move(to: CGPoint(x: a.sx, y: a.sy))
                        path.addLine(to: CGPoint(x: b.sx, y: b.sy))
                        context.stroke(path, with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha)), lineWidth: 0.5)
                    }
                }
            }
        }

        // Nodes
        for n in projected {
            let alpha = max(0, (n.depth + 1.5) / 2.5)
            let pa = 0.5 + sin(n.pulse + time) * 0.3
            let s = n.size * n.scale * (1 + speakIntensity * 0.5)

            // Glow
            let g = s * 3
            context.fill(
                Path(ellipseIn: CGRect(x: n.sx - g, y: n.sy - g, width: g * 2, height: g * 2)),
                with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha * 0.1 * pa))
            )
            // Core
            context.fill(
                Path(ellipseIn: CGRect(x: n.sx - s, y: n.sy - s, width: s * 2, height: s * 2)),
                with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha * 0.8 * pa))
            )
            // Bright center
            let c = s * 0.4
            context.fill(
                Path(ellipseIn: CGRect(x: n.sx - c, y: n.sy - c, width: c * 2, height: c * 2)),
                with: .color(.white.opacity(alpha * 0.6 * pa))
            )
        }
    }
}
