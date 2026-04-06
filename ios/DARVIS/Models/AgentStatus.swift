import Foundation

struct AgentStatus: Codable {
    let active: Bool
    let goal: String
    let step: Int
    let thinking: String
    let done: Bool
}
