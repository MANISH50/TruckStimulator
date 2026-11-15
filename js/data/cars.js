// Long Drive mode: fast, comfortable cars. Generic and unbranded, all unlocked.
// Same fields as trucks (see trucks.js) so the same physics code drives them.
export const CARS = [
  {
    id: 'sedan', name: 'Luxury Sedan', desc: 'Quiet, smooth and fast. Built for long highway drives. 200 km/h.',
    car: true, body: 'sedan', mass: 1750, capacity: 0, vmax: 200, governor: null, pmul: 1.35, a1: 5.5, q: 1.32, brake: 9.0,
    wheelbase: 2.95, maxSteer: 0.58, length: 5.0, width: 1.9, trailer: 0, tank: 16, cogH: 0.55, grip: 8.5, CdA: 0.66,
    color: '#1f3a5f', accent: '#c9d6e3', stats: { speed: 4, pickup: 4, size: 2, handling: 1 }, cyl: 6, fast: true,
  },
  {
    id: 'coupe', name: 'Sports Coupe', desc: 'Low and powerful. The fastest way across India. 250 km/h.',
    car: true, body: 'coupe', mass: 1500, capacity: 0, vmax: 250, governor: null, pmul: 1.35, a1: 7.0, q: 1.3, brake: 10.0,
    wheelbase: 2.7, maxSteer: 0.58, length: 4.6, width: 1.95, trailer: 0, tank: 14, cogH: 0.48, grip: 9.5, CdA: 0.62,
    color: '#b3261e', accent: '#1b1b1b', stats: { speed: 5, pickup: 5, size: 1, handling: 2 }, cyl: 8, fast: true,
  },
  {
    id: 'suv', name: 'Comfort SUV', desc: 'Tall seating, soft ride, relaxed cruising. 180 km/h.',
    car: true, body: 'suv', mass: 2300, capacity: 0, vmax: 180, governor: null, pmul: 1.35, a1: 5.0, q: 1.32, brake: 8.5,
    wheelbase: 2.95, maxSteer: 0.6, length: 4.9, width: 2.0, trailer: 0, tank: 18, cogH: 0.75, grip: 8.0, CdA: 0.95,
    color: '#e8e8e4', accent: '#3a3a3a', stats: { speed: 3, pickup: 3, size: 3, handling: 1 }, cyl: 6, fast: true,
  },
];
export function carById(id) { return CARS.find((c) => c.id === id) || CARS[0]; }
// a car carries no cargo
export const NO_CARGO = { id: 'none', name: 'Passengers', icon: '🧳', mass: 150, cog: 0, fragility: 0.6, pay: 0, rule: '', needs: 'any', spill: 'none' };
