import EventKit
import Foundation

struct Event: Codable {
    let title: String
    let start: String
    let end: String
    let allDay: Bool
}

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var granted = false

// Ask for calendar access (async → we wait on a semaphore).
store.requestFullAccessToEvents { ok, _ in
    granted = ok
    sema.signal()
}
sema.wait()

if !granted {
    print("{\"error\":\"denied\"}")
    exit(0)
}

// Today's window: midnight to midnight.
let cal = Calendar.current
let startOfDay = cal.startOfDay(for: Date())
let endOfDay = cal.date(byAdding: .day, value: 1, to: startOfDay)!

let predicate = store.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
let iso = ISO8601DateFormatter()

let events = store.events(matching: predicate)
    .sorted { $0.startDate < $1.startDate }
    .map { ev in
        Event(
            title: ev.title ?? "(No title)",
            start: iso.string(from: ev.startDate),
            end: iso.string(from: ev.endDate),
            allDay: ev.isAllDay
        )
    }

let data = try JSONEncoder().encode(events)
print(String(data: data, encoding: .utf8)!)