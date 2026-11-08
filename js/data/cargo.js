// Cargo jobs. mass is a full load in kg (scaled by the truck's capacity).
// cog: extra centre-of-gravity height (m) -> rollover risk.
// fragility: how much harsh driving damages the cargo.
// cap: speed limit km/h for this load (tankers/dumpers 60 km/h by Indian rules).
// needs: which truck bodies can carry it.
export const CARGO = [
  { id: 'goods', name: 'General Goods', icon: '📦', mass: 14000, cog: 0.6, fragility: 0.5, pay: 18, rule: 'Balanced load. Good first job.', needs: 'any', spill: 'boxes' },
  { id: 'ore', name: 'Iron Ore', icon: '⛰️', mass: 26000, cog: 0.3, fragility: 0.05, pay: 24, cap: 60, rule: 'Very heavy. Slow on hills. Dumper limit 60 km/h.', needs: 'open', spill: 'ore' },
  { id: 'timber', name: 'Wooden Logs', icon: '🪵', mass: 18000, cog: 0.8, fragility: 0.2, pay: 20, rule: 'Logs can shift on hard braking.', needs: 'any', spill: 'logs' },
  { id: 'cars', name: 'New Cars', icon: '🚗', mass: 12000, cog: 1.4, fragility: 0.9, pay: 34, rule: 'Car carrier. High and tippy on sharp turns.', needs: 'trailer', spill: 'cars' },
  { id: 'fuel', name: 'Diesel Tanker', icon: '🛢️', mass: 22000, cog: 0.9, fragility: 0.3, pay: 32, cap: 60, rule: 'Hazardous! Liquid sloshes. 60 km/h limit.', needs: 'trailer', spill: 'fire', tank: '#d8dde2' },
  { id: 'steel', name: 'Steel Coils', icon: '🧲', mass: 25000, cog: 0.4, fragility: 0.1, pay: 26, rule: 'Huge momentum. Long braking distance.', needs: 'any', spill: 'coils' },
  { id: 'container', name: 'Container', icon: '🚢', mass: 20000, cog: 1.1, fragility: 0.4, pay: 25, rule: 'Tall box. Sways in wind on highways.', needs: 'any', spill: 'boxes' },
  { id: 'veg', name: 'Fruits & Vegetables', icon: '🥭', mass: 9000, cog: 0.7, fragility: 0.6, pay: 22, timed: true, rule: 'Fresh produce. Arrive on time!', needs: 'any', spill: 'veg' },
  { id: 'glass', name: 'Glass & Electronics', icon: '📺', mass: 7000, cog: 0.8, fragility: 1.6, pay: 36, rule: 'Fragile! Bumps and hard braking cost money.', needs: 'any', spill: 'boxes' },
  { id: 'cement', name: 'Cement Bags', icon: '🧱', mass: 21000, cog: 0.5, fragility: 0.15, pay: 21, rule: 'Heavy, steady load.', needs: 'any', spill: 'bags' },
  { id: 'milk', name: 'Milk Tanker', icon: '🥛', mass: 15000, cog: 0.9, fragility: 0.3, pay: 27, timed: true, cap: 60, rule: 'Keep it cool: arrive on time. 60 km/h limit.', needs: 'trailer', spill: 'milk', tank: '#e9eef2' },
];

export function cargoById(id) { return CARGO.find((c) => c.id === id) || CARGO[0]; }

// Can this truck carry this cargo?
export function canCarry(truck, cargo) {
  if (cargo.needs === 'any') return true;
  if (cargo.needs === 'trailer') return truck.trailer > 0;
  if (cargo.needs === 'open') return truck.trailer === 0 || truck.id === 'trailer';
  return true;
}
