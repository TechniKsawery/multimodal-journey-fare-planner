// Helpers shared by the time-based city tariffs (ZTM/MPK/BVG/ŁKA): pick the shortest ticket whose validity covers the ride.
import type { Table } from "./model";

export function sortedTickets(table: Table): Table[] {
  // Array.prototype.sort is stable, like Python's sorted().
  return [...(table["bilety_czasowe"] as Table[])].sort((a, b) => a["wazny_min"] - b["wazny_min"]);
}

export function pickTicket(tickets: Table[], durationMin: number): Table {
  for (const bilet of tickets) {
    if (durationMin <= bilet["wazny_min"]) return bilet;
  }
  return tickets[tickets.length - 1];
}
