// The 5 trucks. All unlocked from the start.
// mass: empty mass (kg). capacity: share of a full load it can carry.
// vmax: top speed km/h. governor: legal limit km/h (null = none).
// a1: target acceleration in 1st gear when empty (m/s^2) -> "pickup".
// q: gear step ratio. brake: max braking decel when empty (m/s^2).
// wheelbase (m), maxSteer (rad), trailer: trailer length (m) or 0.
export const TRUCKS = [
  {
    id: 'mini', name: 'Mini Truck', desc: 'Light and nimble city carrier. Easy to drive.',
    mass: 2600, capacity: 0.25, vmax: 95, governor: 80, pmul: 2.4, a1: 4.4, q: 1.45, brake: 6.5,
    wheelbase: 2.6, maxSteer: 0.62, length: 5.2, width: 2.0, trailer: 0, tank: 4.2, bed: { w: 1.9, l: 3.0, x: -0.9 },
    color: '#e8e8e8', accent: '#1f5fbf', stats: { speed: 2, pickup: 5, size: 1, handling: 1 }, body: 'lcv', cyl: 4,
  },
  {
    id: 'cargo', name: 'Cargo Truck', desc: 'Classic 10-wheeler with a high wooden body.',
    mass: 7500, capacity: 0.7, vmax: 95, governor: 80, pmul: 2.0, a1: 3.6, q: 1.42, brake: 5.6,
    wheelbase: 5.2, maxSteer: 0.55, length: 9.4, width: 2.5, trailer: 0, tank: 4.6, bed: { w: 2.45, l: 6.2, x: -2.3 },
    color: '#f2a516', accent: '#c4262e', stats: { speed: 2, pickup: 3, size: 3, handling: 3 }, body: 'rigid', cyl: 6,
  },
  {
    id: 'trailer', name: 'Trailer Truck', desc: 'Long articulated rig. The trailer swings on turns.',
    mass: 9000, capacity: 1.0, vmax: 95, governor: 80, pmul: 2.2, a1: 3.3, q: 1.4, brake: 5.2,
    wheelbase: 3.9, maxSteer: 0.6, length: 6.6, width: 2.5, trailer: 12.2, tank: 5.0, bed: { w: 2.5, l: 11.6, x: 0 },
    color: '#c62a2a', accent: '#f4d03f', stats: { speed: 2, pickup: 2, size: 5, handling: 5 }, body: 'tractor', cyl: 6,
  },
  {
    id: 'express', name: 'Highway Express', desc: 'Sleek fast rigid truck for long highways. 130 km/h.',
    mass: 7000, capacity: 0.6, vmax: 130, governor: 80, pmul: 1.75, a1: 4.0, q: 1.45, brake: 6.0,
    wheelbase: 5.0, maxSteer: 0.55, length: 9.6, width: 2.5, trailer: 0, tank: 4.4, bed: { w: 2.45, l: 6.4, x: -2.3 },
    color: '#2b6fd6', accent: '#d9e2ea', stats: { speed: 4, pickup: 4, size: 3, handling: 3 }, body: 'express', cyl: 6, fast: true,
  },
  {
    id: 'turbo', name: 'Turbo Hauler', desc: 'Monster tractor with twin stacks. 160 km/h. Hard to stop!',
    mass: 8500, capacity: 0.8, vmax: 165, governor: 80, pmul: 1.6, a1: 4.6, q: 1.5, brake: 5.2,
    wheelbase: 3.9, maxSteer: 0.58, length: 6.8, width: 2.5, trailer: 9.4, tank: 4.2, bed: { w: 2.5, l: 8.8, x: 0 },
    color: '#1b1b1f', accent: '#ff6a00', stats: { speed: 5, pickup: 5, size: 4, handling: 5 }, body: 'tractor', cyl: 8, fast: true,
  },
];

export function truckById(id) { return TRUCKS.find((t) => t.id === id) || TRUCKS[1]; }

// top of the speedometer scale for this truck
export function dialMax(spec) { return spec.vmax > 100 ? Math.ceil((spec.vmax + 5) / 20) * 20 : 120; }
