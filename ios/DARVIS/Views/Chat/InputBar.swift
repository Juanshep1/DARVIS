import SwiftUI

struct InputBar: View {
    @Binding var text: String
    let isRecording: Bool
    let cameraActive: Bool
    let isFixing: Bool
    let onSend: () -> Void
    let onMicToggle: () -> Void
    let onCameraToggle: () -> Void
    let onFixYourself: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Ornament divider
            ZStack {
                Rectangle().fill(Color.paperEdge).frame(height: 0.5)
                Text("◈")
                    .font(.almanacBody(14))
                    .foregroundColor(.rubric)
                    .padding(.horizontal, 10)
                    .background(Color.paper)
            }
            .padding(.horizontal, 30)

            HStack(spacing: 12) {
                // Dip-pen text field — underline only, no border
                TextField("", text: $text, prompt: Text("Enter your correspondence…")
                    .font(.almanacBodyItalic(16))
                    .foregroundColor(.inkGhost))
                    .textFieldStyle(.plain)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 4)
                    .font(.almanacBody(17))
                    .foregroundColor(.ink)
                    .overlay(
                        Rectangle()
                            .fill(text.isEmpty ? Color.ink.opacity(0.4) : Color.rubric)
                            .frame(height: 1),
                        alignment: .bottom
                    )
                    .onSubmit {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        onSend()
                    }

                // Stamp buttons — square wax seals with gilt border
                stampButton(
                    label: "v",
                    active: isRecording,
                    activeColor: .rubric,
                    action: onMicToggle
                )

                stampButton(
                    label: "o",
                    active: cameraActive,
                    activeColor: .stateLive,
                    action: onCameraToggle
                )

                stampButton(
                    systemIcon: "wrench",
                    active: isFixing,
                    activeColor: .gilt,
                    action: onFixYourself
                )
                .disabled(isFixing)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
            .padding(.bottom, 4)
        }
        .background(Color.paper)
    }

    // Wax-seal stamp button
    @ViewBuilder
    private func stampButton(
        label: String? = nil,
        systemIcon: String? = nil,
        active: Bool,
        activeColor: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if let label = label {
                    Text(label)
                        .font(.almanacDisplay(22).italic())
                        .foregroundColor(active ? .paper : .gilt)
                } else if let icon = systemIcon {
                    Image(systemName: icon)
                        .font(.system(size: 14))
                        .foregroundColor(active ? .paper : .gilt)
                }
            }
            .frame(width: 44, height: 44)
            .background(active ? activeColor : Color.paperWarm)
            .overlay(Rectangle().stroke(active ? activeColor : Color.gilt.opacity(0.5), lineWidth: 1))
            .shadow(color: Color.paperFold.opacity(0.5), radius: 0, x: 2, y: 2)
        }
    }
}
