import type { EmployeeRole } from '../types';

export interface EmployeeRoleDef {
  id: EmployeeRole;
  name: string;
  emoji: string;
  description: string;
  hireCost: number;   // einmalig
  wagePerDay: number;  // € pro echtem Tag (86.400 Ticks)
}

export const EMPLOYEE_ROLES: Record<EmployeeRole, EmployeeRoleDef> = {
  farmer: {
    id: 'farmer', name: 'Farmer', emoji: '👨‍🌾',
    description: 'Bedient Traktor, Pflug, Sämaschine & Mähdrescher — pflügt, sät und erntet Felder.',
    hireCost: 500, wagePerDay: 150,
  },
  driver: {
    id: 'driver', name: 'LKW-Fahrer', emoji: '🚚',
    description: 'Fährt den Transporter für Lieferungen zwischen deinen Standorten.',
    hireCost: 500, wagePerDay: 120,
  },
};

export const EMPLOYEE_ROLE_LIST = Object.values(EMPLOYEE_ROLES);
