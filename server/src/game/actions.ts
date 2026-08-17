import {
  unlockFarm, openNewFarm, buyPlot, tillPlot, plantCrop, harvestPlot,
  buildStall, buildSecondHalfStall, collectStall, buyAnimal, sellFromStorage,
  buildProcessingBuilding, loadProcessing, collectProcessingOutput,
  setSlaughterTarget, setSlaughterAnimal,
  buyVehicle, moveVehicle, buyImplement, moveImplement,
  designateField, demolishPlot, sellToMerchant,
  startDelivery,
  hireEmployee, moveEmployee, fireEmployee,
  unlockHofladen, setHofladenOffer, stockHofladen, unstockHofladen, removeHofladenOffer,
} from '../../../src/farm/Farm';

// Every value-changing action the client used to apply to its own copy of GameState.
// The server now owns all of these — the client only ever sends "type + args", never
// a finished state. Deliberately excluded: setActiveFarm (pure client-side navigation,
// no value flows through it) and all read-only helpers (growthProgress, currentPrice, …).
//
// Argument order matches each function's own signature below (state is always prepended
// by the dispatcher, so `args` only lists what comes after it):
export const GAME_ACTIONS = {
  // farmId
  unlockFarm,
  // city, farmName, lat, lon, cost
  openNewFarm,
  // farmId, plotId
  buyPlot,
  // farmId, plotId
  designateField,
  // farmId, plotId
  tillPlot,
  // farmId, plotId, cropId
  plantCrop,
  // farmId, plotId
  harvestPlot,
  // farmId, plotId
  demolishPlot,
  // farmId, plotId, animalId, size
  buildStall,
  // farmId, plotId, animalId
  buildSecondHalfStall,
  // farmId, plotId, slot?
  collectStall,
  // farmId, plotId, slot?
  buyAnimal,
  // farmId, plotId, buildingId
  buildProcessingBuilding,
  // farmId, plotId, slotIdx
  loadProcessing,
  // farmId, plotId, slotIdx
  collectProcessingOutput,
  // farmId, plotId, slotIdx, animalId
  setSlaughterAnimal,
  // farmId, plotId, slotIdx, target
  setSlaughterTarget,
  // farmId, productId, amount, pricePerUnit
  sellToMerchant,
  // farmId, productId, amount
  sellFromStorage,
  // fromFarmId, toFarmId, productId, amount
  startDelivery,
  // defId, farmId
  buyVehicle,
  // uid, targetFarmId
  moveVehicle,
  // defId, farmId
  buyImplement,
  // uid, targetFarmId
  moveImplement,
  // farmId, role
  hireEmployee,
  // uid, targetFarmId
  moveEmployee,
  // uid
  fireEmployee,
  // farmId
  unlockHofladen,
  // farmId, productId, pricePerUnit
  setHofladenOffer,
  // farmId, productId, amount
  stockHofladen,
  // farmId, productId, amount
  unstockHofladen,
  // farmId, index
  removeHofladenOffer,
} as const;

export type GameActionType = keyof typeof GAME_ACTIONS;

export function isGameActionType(type: unknown): type is GameActionType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(GAME_ACTIONS, type);
}
