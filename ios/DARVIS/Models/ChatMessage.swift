import Foundation

struct ChatMessage: Identifiable, Codable {
    var id = UUID()
    let role: String
    let content: String
    var timestamp: Date = Date()

    enum CodingKeys: String, CodingKey {
        case role, content
    }
}
