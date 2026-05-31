export type VehicleTask = 'till' | 'plant' | 'harvest' | 'transport' | 'milk' | 'fertilize' | 'load';

export interface VehicleDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  price: number;
  tasks: VehicleTask[];
}

export const VEHICLES: Record<string, VehicleDef> = {
  traktor: {
    id: 'traktor', name: 'Traktor', emoji: '🚜',
    description: 'Das Arbeitstier des Betriebs. Pflügt, sät und erntet.',
    price: 15000,
    tasks: ['till', 'plant', 'harvest'],
  },
  frontlader: {
    id: 'frontlader', name: 'Frontlader', emoji: '🏗️',
    description: 'Bewegt schwere Lasten auf dem Hof.',
    price: 8000,
    tasks: ['load'],
  },
  guellefahrzeug: {
    id: 'guellefahrzeug', name: 'Güllefass', emoji: '💧',
    description: 'Verteilt Gülle und Dünger auf den Feldern.',
    price: 12000,
    tasks: ['fertilize'],
  },
  maehdrescher: {
    id: 'maehdrescher', name: 'Mähdrescher', emoji: '🌾',
    description: 'Spezialist für die Getreideernte. Hohe Flächenleistung.',
    price: 45000,
    tasks: ['harvest'],
  },
  transporter: {
    id: 'transporter', name: 'Transporter', emoji: '🚛',
    description: 'Transportiert Waren zwischen Standorten.',
    price: 28000,
    tasks: ['transport'],
  },
  melkroboter: {
    id: 'melkroboter', name: 'Melkroboter', emoji: '🤖',
    description: 'Automatisiert die Melkarbeit im Stall rund um die Uhr.',
    price: 55000,
    tasks: ['milk'],
  },
};

export const VEHICLE_LIST = Object.values(VEHICLES);

export const TASK_LABELS: Record<VehicleTask, string> = {
  till:       '🪧 Pflügen',
  plant:      '🌱 Säen',
  harvest:    '🌾 Ernten',
  transport:  '🚛 Transport',
  milk:       '🥛 Melken',
  fertilize:  '💧 Düngen',
  load:       '📦 Verladen',
};
