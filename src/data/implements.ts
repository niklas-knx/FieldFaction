export type ImplementTask = 'till' | 'plant' | 'fertilize';

export interface ImplementDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  price: number;
  task: ImplementTask;
  requiresVehicle: string[];  // vehicle defIds that can tow this
  durationTicks: number;      // how long one field operation takes (for future automation)
}

export const IMPLEMENTS: Record<string, ImplementDef> = {
  pflug: {
    id: 'pflug', name: 'Pflug', emoji: '⛏️',
    description: 'Wendet den Boden um und bereitet das Saatbett vor. Wird hinten an den Traktor gehängt.',
    price: 4500,
    task: 'till',
    requiresVehicle: ['traktor'],
    durationTicks: 60,
  },
  saemaschine: {
    id: 'saemaschine', name: 'Sämaschine', emoji: '🌱',
    description: 'Sät Saatgut präzise in gleichmäßigen Reihen. Wird hinten an den Traktor gehängt.',
    price: 7500,
    task: 'plant',
    requiresVehicle: ['traktor'],
    durationTicks: 90,
  },
  duengerstreuer: {
    id: 'duengerstreuer', name: 'Düngerstreuer', emoji: '💨',
    description: 'Verteilt Mineraldünger gleichmäßig über das Feld. Wird hinten an den Traktor gehängt.',
    price: 5500,
    task: 'fertilize',
    requiresVehicle: ['traktor'],
    durationTicks: 60,
  },
};

export const IMPLEMENT_LIST = Object.values(IMPLEMENTS);

export const IMPLEMENT_TASK_LABELS: Record<ImplementTask, string> = {
  till:      '⛏️ Pflügen',
  plant:     '🌱 Säen',
  fertilize: '💨 Düngen',
};
