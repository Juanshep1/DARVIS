import SwiftUI

// ═══════════════════════════════════════════════════════════════════
// THE SPECTRA ALMANAC — iOS Theme
// Dark leather folio lit by a single oil lamp.
// Matches the browser UI at darvis1.netlify.app exactly.
// ═══════════════════════════════════════════════════════════════════

// MARK: - Colors

extension Color {
    // Base — dark leather ground
    static let paper        = Color(red: 0.051, green: 0.039, blue: 0.027)  // #0d0a07
    static let paperWarm    = Color(red: 0.078, green: 0.063, blue: 0.039)  // #14100a
    static let paperCool    = Color(red: 0.102, green: 0.078, blue: 0.051)  // #1a140d
    static let paperEdge    = Color(red: 0.227, green: 0.180, blue: 0.122)  // #3a2e1f
    static let paperFold    = Color(red: 0.290, green: 0.231, blue: 0.157)  // #4a3b28

    // Ink — warm cream text on dark leather
    static let ink          = Color(red: 0.925, green: 0.882, blue: 0.776)  // #ece1c6
    static let inkSoft      = Color(red: 0.784, green: 0.741, blue: 0.647)  // #c8bda5
    static let inkFaint     = Color(red: 0.561, green: 0.522, blue: 0.451)  // #8f8573
    static let inkGhost     = Color(red: 0.353, green: 0.329, blue: 0.267)  // #5a5444

    // Rubrication — oxblood accents
    static let rubric       = Color(red: 0.890, green: 0.322, blue: 0.322)  // #e35252
    static let rubricDeep   = Color(red: 0.659, green: 0.157, blue: 0.157)  // #a82828

    // Gilt — antique gold
    static let gilt         = Color(red: 0.831, green: 0.659, blue: 0.278)  // #d4a847
    static let giltDark     = Color(red: 0.561, green: 0.431, blue: 0.118)  // #8f6e1e

    // Seal
    static let seal         = Color(red: 0.478, green: 0.106, blue: 0.106)  // #7a1b1b

    // Status (muted for the dark aesthetic)
    static let stateLive    = Color(red: 0.435, green: 0.827, blue: 0.435)  // #6fd36f
    static let stateWarn    = Color(red: 0.831, green: 0.659, blue: 0.278)  // #d4a847 (gilt)
    static let stateAlarm   = Color(red: 0.890, green: 0.322, blue: 0.322)  // #e35252 (rubric)

    // Legacy aliases — keep old code working while we migrate
    static let spectraBackground = paper
    static let spectraCyan       = gilt
    static let spectraGlow       = gilt
    static let spectraText       = ink
    static let spectraDim        = inkFaint
    static let spectraGreen      = stateLive
    static let spectraOrange     = stateWarn
    static let spectraRed        = stateAlarm
}

// MARK: - Fonts

extension Font {
    /// Display face — system serif (matches Fraunces feel on iOS).
    /// If custom Fraunces font is bundled, it will be used automatically.
    static func almanacDisplay(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    /// Body face — system serif (matches EB Garamond feel).
    static func almanacBody(_ size: CGFloat) -> Font {
        .system(size: size, design: .serif)
    }

    /// Body italic
    static func almanacBodyItalic(_ size: CGFloat) -> Font {
        .system(size: size, design: .serif).italic()
    }

    /// Mono labels — system monospaced (matches IBM Plex Mono feel).
    static func almanacMono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    /// Masthead brand — large serif bold
    static func almanacMasthead(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .serif)
    }
}

// MARK: - Card Modifier

/// Almanac-style card — sharp corners, 1px gilt border, paper-fold offset shadow.
struct AlmanacCard: ViewModifier {
    var borderColor: Color = .gilt
    var borderWidth: CGFloat = 1

    func body(content: Content) -> some View {
        content
            .background(Color.paperWarm)
            .clipShape(Rectangle())
            .overlay(Rectangle().stroke(borderColor.opacity(0.4), lineWidth: borderWidth))
            .shadow(color: Color.paperFold.opacity(0.6), radius: 0, x: 3, y: 4)
    }
}

/// Rubric-accented card — left border in oxblood
struct RubricCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color.paperWarm)
            .clipShape(Rectangle())
            .overlay(
                HStack(spacing: 0) {
                    Rectangle().fill(Color.rubric).frame(width: 3)
                    Spacer()
                }
            )
            .overlay(Rectangle().stroke(Color.gilt.opacity(0.2), lineWidth: 0.5))
    }
}

// MARK: - View Extensions

extension View {
    func hudCard() -> some View { modifier(AlmanacCard()) }
    func almanacCard(border: Color = .gilt) -> some View { modifier(AlmanacCard(borderColor: border)) }
    func rubricCard() -> some View { modifier(RubricCard()) }
}

// MARK: - Section Header

/// Almanac-style section header with `// 01` numbering
struct AlmanacSectionHeader: View {
    let number: String
    let title: String

    var body: some View {
        HStack(spacing: 8) {
            Text("// \(number)")
                .font(.almanacMono(9, weight: .medium))
                .foregroundColor(.gilt)
            Text(title.uppercased())
                .font(.almanacMono(9, weight: .medium))
                .foregroundColor(.inkSoft)
                .tracking(2.5)
            Rectangle()
                .fill(Color.gilt.opacity(0.25))
                .frame(height: 0.5)
        }
        .padding(.top, 18)
        .padding(.bottom, 6)
    }
}
