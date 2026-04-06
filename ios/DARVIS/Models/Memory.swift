import Foundation

struct Memory: Identifiable, Codable {
    let id: Int
    let content: String
    let category: String
    let created: String
}

struct MemoryResponse: Codable {
    let memories: [Memory]
}
