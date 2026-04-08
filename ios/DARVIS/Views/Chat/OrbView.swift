import SwiftUI

enum OrbState {
    case idle, thinking, speaking, listening
}

struct OrbView: View {
    let state: OrbState
    @State private var phase: Double = 0
    @State private var speakIntensity: Double = 0

    // Match browser colors exactly
    var targetColor: (r: Double, g: Double, b: Double) {
        switch state {
        case .idle:      return (0.31, 0.71, 1.0)   // cyan/blue
        case .thinking:  return (1.0, 0.67, 0.25)    // orange
        case .speaking:  return (0.0, 0.9, 1.0)      // bright cyan
        case .listening: return (1.0, 0.32, 0.32)    // red
        }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            Canvas { context, size in
                let cx = size.width / 2
                let cy = size.height / 2
                let radius: Double = min(size.width, size.height) * 0.36
                let nodeCount = 120
                let connectionDist: Double = radius * 0.6
                let tc = targetColor

                // Center glow (matching browser radial gradient)
                let glowRadius = radius * 0.6
                let glowSteps = 10
                for i in stride(from: glowSteps, through: 1, by: -1) {
                    let frac = Double(i) / Double(glowSteps)
                    let s = glowRadius * frac
                    let alpha = (0.06 + speakIntensity * 0.08) * (1 - frac)
                    let rect = CGRect(x: cx - s, y: cy - s, width: s * 2, height: s * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha)))
                }

                // Generate and project nodes (fibonacci sphere)
                let goldenAngle = Double.pi * (3 - sqrt(5))
                let rotY = phase
                let rotX = sin(phase * 0.3) * 0.3
                let cosY = cos(rotY), sinY = sin(rotY)
                let cosX = cos(rotX), sinX = sin(rotX)
                let time = phase * 2

                struct ProjectedNode {
                    let sx: Double, sy: Double, depth: Double, pulse: Double, scale: Double, size: Double
                }

                var nodes: [ProjectedNode] = []
                // Use a seeded sequence for consistent random values
                var seed: UInt64 = 42
                func nextRand() -> Double {
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407
                    return Double((seed >> 33) ^ seed) / Double(UInt32.max)
                }

                for i in 0..<nodeCount {
                    let y = 1 - (Double(i) / Double(nodeCount - 1)) * 2
                    let radiusAtY = sqrt(1 - y * y)
                    let theta = goldenAngle * Double(i)
                    let ox = cos(theta) * radiusAtY
                    let oy = y
                    let oz = sin(theta) * radiusAtY

                    // Rotate Y
                    let x1 = ox * cosY - oz * sinY
                    let z1 = ox * sinY + oz * cosY
                    // Rotate X
                    let y1 = oy * cosX - z1 * sinX
                    let z2 = oy * sinX + z1 * cosX

                    let pulse = nextRand() * Double.pi * 2
                    let nodeSize = 1.5 + nextRand() * 2.0

                    // Speak distortion
                    let dist = 1 + speakIntensity * (0.15 + sin(pulse + phase * 5) * 0.1)

                    let scale = 1 / (1 + z2 * 0.3)
                    let sx = cx + x1 * radius * scale * dist
                    let sy = cy + y1 * radius * scale * dist

                    nodes.append(ProjectedNode(sx: sx, sy: sy, depth: z2, pulse: pulse, scale: scale, size: nodeSize))
                }

                // Sort by depth
                nodes.sort { $0.depth < $1.depth }

                // Draw connections
                for i in 0..<nodes.count {
                    for j in (i + 1)..<nodes.count {
                        let a = nodes[i], b = nodes[j]
                        let dx = a.sx - b.sx, dy = a.sy - b.sy
                        let d = sqrt(dx * dx + dy * dy)
                        if d < connectionDist {
                            let depthFactor = (a.depth + b.depth + 2) / 4
                            let alpha = (1 - d / connectionDist) * 0.3 * max(0, depthFactor)
                            var path = Path()
                            path.move(to: CGPoint(x: a.sx, y: a.sy))
                            path.addLine(to: CGPoint(x: b.sx, y: b.sy))
                            context.stroke(path, with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha)), lineWidth: 0.5)
                        }
                    }
                }

                // Draw nodes
                for n in nodes {
                    let alpha = max(0, (n.depth + 1.5) / 2.5)
                    let pulseAlpha = 0.5 + sin(n.pulse + time) * 0.3
                    let s = n.size * n.scale * (1 + speakIntensity * 0.5)

                    // Glow
                    let g = s * 3
                    context.fill(
                        Path(ellipseIn: CGRect(x: n.sx - g, y: n.sy - g, width: g * 2, height: g * 2)),
                        with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha * 0.1 * pulseAlpha))
                    )

                    // Core
                    context.fill(
                        Path(ellipseIn: CGRect(x: n.sx - s, y: n.sy - s, width: s * 2, height: s * 2)),
                        with: .color(Color(red: tc.r, green: tc.g, blue: tc.b, opacity: alpha * 0.8 * pulseAlpha))
                    )

                    // Bright center
                    let c = s * 0.4
                    context.fill(
                        Path(ellipseIn: CGRect(x: n.sx - c, y: n.sy - c, width: c * 2, height: c * 2)),
                        with: .color(.white.opacity(alpha * 0.6 * pulseAlpha))
                    )
                }
            }
        }
        .frame(width: 300, height: 300)
        .onAppear { startAnimation() }
        .onChange(of: state) { _, newState in
            if newState == .speaking {
                speakIntensity = 1.0
            }
        }
    }

    private func startAnimation() {
        Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in
            DispatchQueue.main.async {
                phase += 0.003 + speakIntensity * 0.015
                speakIntensity *= 0.95
                if state == .speaking {
                    speakIntensity = max(speakIntensity, 0.5)
                }
            }
        }
    }
}
