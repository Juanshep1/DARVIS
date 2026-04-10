import SwiftUI

extension Color {
    static let spectraBackground = Color(red: 0.04, green: 0.04, blue: 0.06)
    static let spectraCyan = Color(red: 0.29, green: 0.56, blue: 0.85)
    static let spectraGlow = Color(red: 0.20, green: 0.55, blue: 1.0)
    static let spectraText = Color(red: 0.88, green: 0.88, blue: 0.88)
    static let spectraDim = Color(red: 0.35, green: 0.35, blue: 0.42)
    static let spectraGreen = Color(red: 0.31, green: 1.0, blue: 0.63)
    static let spectraOrange = Color(red: 1.0, green: 0.71, blue: 0.31)
    static let spectraRed = Color(red: 1.0, green: 0.39, blue: 0.39)
}

struct HUDCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color(red: 0.06, green: 0.06, blue: 0.10).opacity(0.95))
            .cornerRadius(12)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.spectraCyan.opacity(0.2), lineWidth: 1))
    }
}

extension View {
    func hudCard() -> some View { modifier(HUDCard()) }
}
