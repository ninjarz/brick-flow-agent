import type { BuildPlan, GeneratorInput } from '../types/bricks'
import { createId, createSingleBrickSteps, makeBrick } from './planUtils'

const assemblePlan = (
  title: string,
  prompt: string,
  bricks: ReturnType<typeof makeBrick>[],
  imageName?: string,
): BuildPlan => ({
  id: createId('plan'),
  title,
  prompt,
  source: 'template-local',
  imageName,
  bricks,
  steps: createSingleBrickSteps(bricks),
})

const carPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'gray', 0, 0, 0),
    makeBrick('brick-2x4', 'red', 1, 0.4, 1),
    makeBrick('brick-2x2', 'red', 2, 1.6, 1),
    makeBrick('tile-1x2', 'white', 1, 2.8, 1),
    makeBrick('tile-1x2', 'white', 4, 1.6, 1, 1),
  ]
  return assemblePlan('无轮小车轮廓', prompt, bricks, imageName)
}

const bridgePlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'gray', 0, 0, 0),
    makeBrick('brick-2x2', 'tan', 0, 0.4, 1),
    makeBrick('brick-2x2', 'tan', 4, 0.4, 1),
    makeBrick('brick-2x2', 'tan', 0, 1.6, 1),
    makeBrick('brick-2x2', 'tan', 4, 1.6, 1),
    makeBrick('arch-1x4', 'brown', 1, 2.8, 1),
    makeBrick('plate-2x6', 'gray', 0, 4, 1),
    makeBrick('brick-1x4', 'red', 1, 4.4, 1),
    makeBrick('brick-1x4', 'red', 1, 4.4, 2),
    makeBrick('round-1x1-plate', 'yellow', 1, 5.6, 1),
    makeBrick('round-1x1-plate', 'yellow', 4, 5.6, 1),
    makeBrick('round-1x1-plate', 'yellow', 1, 5.6, 2),
    makeBrick('round-1x1-plate', 'yellow', 4, 5.6, 2),
    makeBrick('round-1x1-plate', 'blue', 2, 0.4, 0),
    makeBrick('round-1x1-plate', 'blue', 3, 0.4, 0),
    makeBrick('round-1x1-plate', 'cyan', 2, 0.4, 3),
    makeBrick('round-1x1-plate', 'cyan', 3, 0.4, 3),
    makeBrick('tile-1x2', 'gray', 0, 4.4, 1, 1),
    makeBrick('tile-1x2', 'gray', 5, 4.4, 1, 1),
  ]
  return assemblePlan('小桥', prompt, bricks, imageName)
}

const benchPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'green', 0, 0, 0),
    makeBrick('brick-1x1', 'brown', 1, 0.4, 1),
    makeBrick('brick-1x1', 'brown', 4, 0.4, 1),
    makeBrick('brick-1x1', 'brown', 1, 0.4, 2),
    makeBrick('brick-1x1', 'brown', 4, 0.4, 2),
    makeBrick('plate-2x4', 'tan', 1, 1.6, 1),
    makeBrick('plate-2x4', 'tan', 1, 2, 1),
    makeBrick('brick-1x4', 'brown', 1, 2.4, 2),
    makeBrick('brick-1x2', 'brown', 0, 0.4, 1, 1),
    makeBrick('brick-1x2', 'brown', 5, 0.4, 1, 1),
    makeBrick('slope-cheese-1x1', 'green', 0, 0.4, 3),
    makeBrick('round-1x1-plate', 'red', 5, 0.4, 3),
    makeBrick('round-1x1-plate', 'yellow', 4, 0.4, 3),
    makeBrick('round-1x1-plate', 'orange', 1, 0.4, 3),
    makeBrick('round-1x1-plate', 'pink', 2, 0.4, 3),
    makeBrick('round-1x1-plate', 'lime', 3, 0.4, 3),
    makeBrick('tile-1x1', 'tan', 2, 2.4, 1),
    makeBrick('tile-1x1', 'tan', 3, 2.4, 1),
  ]
  return assemblePlan('公园长椅', prompt, bricks, imageName)
}

const castlePlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'gray', 0, 0, 0),
    makeBrick('brick-2x2', 'gray', 0, 0.4, 0),
    makeBrick('brick-2x2', 'gray', 4, 0.4, 0),
    makeBrick('brick-2x2', 'gray', 0, 1.6, 0),
    makeBrick('brick-2x2', 'gray', 4, 1.6, 0),
    makeBrick('brick-2x4', 'tan', 1, 0.4, 2),
    makeBrick('brick-2x4', 'tan', 1, 1.6, 2),
    makeBrick('plate-2x2', 'red', 0, 2.8, 0),
    makeBrick('plate-2x2', 'red', 4, 2.8, 0),
    makeBrick('brick-1x1', 'gray', 0, 3.2, 0),
    makeBrick('brick-1x1', 'gray', 1, 3.2, 1),
    makeBrick('brick-1x1', 'gray', 4, 3.2, 0),
    makeBrick('brick-1x1', 'gray', 5, 3.2, 1),
    makeBrick('round-1x1-plate', 'yellow', 2, 2.8, 2),
    makeBrick('round-1x1-plate', 'yellow', 3, 2.8, 2),
    makeBrick('tile-1x2', 'black', 2, 2.8, 3),
    makeBrick('round-1x1-plate', 'blue', 2, 0.4, 0),
    makeBrick('round-1x1-plate', 'blue', 3, 0.4, 0),
    makeBrick('round-1x1-plate', 'red', 0, 4.4, 0),
    makeBrick('round-1x1-plate', 'red', 5, 4.4, 1),
  ]
  return assemblePlan('小城堡门楼', prompt, bricks, imageName)
}

const rocketPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'gray', 0, 0, 0),
    makeBrick('round-1x1-plate', 'orange', 2, 0.4, 1),
    makeBrick('round-1x1-plate', 'orange', 3, 0.4, 1),
    makeBrick('plate-2x2', 'red', 2, 0.8, 1),
    makeBrick('slope-1x2', 'blue', 0, 0.4, 1, 1),
    makeBrick('slope-1x2', 'blue', 4, 0.4, 1, 3),
    makeBrick('brick-2x2', 'white', 2, 1.2, 1),
    makeBrick('brick-2x2', 'blue', 2, 2.4, 1),
    makeBrick('headlight-brick-1x1', 'white', 2, 3.6, 1),
    makeBrick('headlight-brick-1x1', 'white', 3, 3.6, 1),
    makeBrick('brick-1x1', 'white', 2, 3.6, 2),
    makeBrick('brick-1x1', 'white', 3, 3.6, 2),
    makeBrick('round-1x1-plate', 'cyan', 2, 3.8, 0.8, 0, 1),
    makeBrick('round-1x1-plate', 'red', 3, 3.8, 0.8, 0, 1),
    makeBrick('brick-2x2', 'red', 2, 4.8, 1),
    makeBrick('cone-2x2', 'yellow', 2, 6, 1),
    makeBrick('round-1x1-plate', 'white', 1, 0.4, 3),
    makeBrick('round-1x1-plate', 'white', 4, 0.4, 3),
  ]
  return assemblePlan('小火箭', prompt, bricks, imageName)
}

const flowerPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'green', 0, 0, 0),
    makeBrick('brick-2x2', 'brown', 2, 0.4, 1),
    makeBrick('plate-2x2', 'brown', 2, 1.6, 1),
    makeBrick('brick-1x1', 'green', 2, 2, 1),
    makeBrick('brick-1x1', 'green', 3, 2, 2),
    makeBrick('slope-1x2', 'green', 1, 3.2, 1),
    makeBrick('slope-1x2', 'green', 3, 3.2, 2, 2),
    makeBrick('brick-1x1', 'green', 2, 4.4, 1),
    makeBrick('brick-1x1', 'green', 3, 4.4, 2),
    makeBrick('plate-2x4', 'red', 1, 5.6, 1),
    makeBrick('round-1x1-plate', 'pink', 1, 6, 1),
    makeBrick('round-1x1-plate', 'pink', 4, 6, 1),
    makeBrick('round-1x1-plate', 'pink', 1, 6, 2),
    makeBrick('round-1x1-plate', 'pink', 4, 6, 2),
    makeBrick('plate-round-2x2-axle', 'yellow', 2, 6, 1),
    makeBrick('slope-cheese-1x1', 'green', 0, 0.4, 3),
    makeBrick('slope-cheese-1x1', 'lime', 5, 0.4, 3, 2),
    makeBrick('round-1x1-plate', 'red', 1, 0.4, 0),
    makeBrick('round-1x1-plate', 'yellow', 4, 0.4, 0),
  ]
  return assemblePlan('小花盆', prompt, bricks, imageName)
}

const ghostPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-2x6', 'white', 0, 0, 0),
    makeBrick('brick-1x2', 'cyan', 5, 0.4, 0, 1),
    makeBrick('tile-eye-1x1', 'white', 4, 5, 2, 2, 1),
    makeBrick('tile-eye-1x1', 'white', 3, 5, 2, 2, 1),
    makeBrick('slope-2x2', 'white', 0, 4.4, 0, 3),
    makeBrick('slope-2x2', 'white', 6, 4.4, 0, 1),
    makeBrick('brick-1x2', 'white', 3, 0.4, 0),
    makeBrick('brick-1x2', 'cyan', 3, 0.4, 1, 2),
    makeBrick('slope-curved-3x2', 'white', 0, 0.4, 0, 2),
    makeBrick('brick-1x2', 'white', 4, 1.6, 0),
    makeBrick('brick-1x2', 'white', 3, 1.6, 0, 1),
    makeBrick('brick-1x2', 'cyan', 4, 1.6, 1, 2),
    makeBrick('slope-2x2', 'white', 1, 1.6, 0, 3),
    makeBrick('plate-2x4', 'white', 2, 2.8, 0),
    makeBrick('slope-1x2-low', 'cyan', 3, 3.2, 0, 1),
    makeBrick('slope-1x2-low', 'cyan', 4, 3.2, 0, 3),
    makeBrick('inverted-slope-3x2', 'white', 0, 3.2, 0),
    makeBrick('inverted-slope-3x2', 'white', 5, 3.2, 0, 2),
    makeBrick('plate-2x4', 'white', 2, 4.4, 0),
    makeBrick('brick-1x2', 'cyan', 5, 4.8, 0, 1),
    makeBrick('brick-1x2', 'white', 2, 4.8, 0, 1),
    makeBrick('brick-1x2', 'trans-pink', 3, 4.8, 0, 2),
    makeBrick('brick-side-studs-1x1', 'cyan', 3, 4.8, 1, 2),
    makeBrick('brick-side-studs-1x1', 'cyan', 4, 4.8, 1, 2),
    makeBrick('slope-2x2', 'white', 2, 6, 0, 3),
    makeBrick('slope-2x2', 'white', 4, 6, 0, 1),
  ]
  return assemblePlan('Classic 小幽灵', prompt, bricks, imageName)
}

const housePlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'green', 0, 0, 0),
    makeBrick('brick-2x4', 'tan', 1, 0.4, 0),
    makeBrick('brick-2x4', 'tan', 1, 0.4, 2),
    makeBrick('brick-1x2', 'tan', 0, 0.4, 1, 1),
    makeBrick('brick-1x2', 'tan', 5, 0.4, 1, 1),
    makeBrick('brick-1x2', 'brown', 1, 1.6, 0),
    makeBrick('brick-trans-1x2', 'green', 3, 1.6, 0),
    makeBrick('brick-1x4', 'tan', 1, 1.6, 2),
    makeBrick('plate-2x4', 'tan', 1, 2.8, 1),
    makeBrick('slope-2x2', 'red', 1, 3.2, 0),
    makeBrick('slope-2x2', 'red', 3, 3.2, 0),
    makeBrick('slope-2x2', 'red', 1, 3.2, 2, 2),
    makeBrick('slope-2x2', 'red', 3, 3.2, 2, 2),
    makeBrick('brick-1x1', 'brown', 5, 0.4, 3),
    makeBrick('round-1x1-plate', 'red', 5, 1.6, 3),
    makeBrick('brick-1x1', 'gray', 2, 4.4, 1),
    makeBrick('round-1x1-plate', 'gray', 2, 5.6, 1),
    makeBrick('round-1x1-plate', 'gray', 2, 6, 1),
    makeBrick('round-1x1-plate', 'yellow', 0, 0.4, 3),
  ]
  return assemblePlan('小房子', prompt, bricks, imageName)
}

const treePlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'green', 0, 0, 0),
    makeBrick('brick-1x2', 'brown', 2, 0.4, 2, 1),
    makeBrick('brick-1x2', 'brown', 2, 1.6, 2, 1),
    makeBrick('brick-1x2', 'brown', 2, 2.8, 2, 1),
    makeBrick('plate-4x4', 'green', 1, 4, 0),
    makeBrick('slope-2x2', 'green', 1, 4.4, 0),
    makeBrick('slope-2x2', 'green', 3, 4.4, 0),
    makeBrick('slope-2x2', 'green', 1, 4.4, 2, 2),
    makeBrick('slope-2x2', 'green', 3, 4.4, 2, 2),
    makeBrick('plate-2x4', 'green', 1, 5.6, 1),
    makeBrick('brick-2x2', 'lime', 2, 6, 2),
    makeBrick('round-1x1-plate', 'red', 1, 6, 1),
    makeBrick('round-1x1-plate', 'yellow', 4, 6, 1),
    makeBrick('round-1x1-plate', 'orange', 1, 6, 2),
    makeBrick('round-1x1-plate', 'red', 4, 6, 2),
    makeBrick('plate-2x2', 'green', 2, 7.2, 2),
    makeBrick('round-1x1-plate', 'orange', 2, 7.6, 2),
    makeBrick('round-1x1-plate', 'yellow', 3, 7.6, 3),
    makeBrick('slope-cheese-1x1', 'green', 0, 0.4, 3),
    makeBrick('slope-cheese-1x1', 'lime', 5, 0.4, 3, 2),
  ]
  return assemblePlan('树', prompt, bricks, imageName)
}

const robotPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'gray', 0, 0, 0),
    makeBrick('slope-1x2', 'gray', 1, 0.4, 0, 1),
    makeBrick('slope-1x2', 'gray', 4, 0.4, 0, 1),
    makeBrick('brick-1x1', 'gray', 1, 1.6, 1),
    makeBrick('brick-1x1', 'gray', 4, 1.6, 1),
    makeBrick('plate-1x4', 'blue', 1, 2.8, 1),
    makeBrick('brick-2x4', 'blue', 1, 3.2, 1),
    makeBrick('plate-1x6', 'gray', 0, 4.4, 1),
    makeBrick('brick-1x1', 'gray', 0, 4.8, 1),
    makeBrick('brick-1x1', 'gray', 5, 4.8, 1),
    makeBrick('round-1x1-plate', 'red', 0, 6, 1),
    makeBrick('round-1x1-plate', 'red', 5, 6, 1),
    makeBrick('brick-side-studs-1x4', 'yellow', 1, 4.8, 1),
    makeBrick('tile-grille-1x2', 'gray', 2, 4.9, 0.6, 0, 1),
    makeBrick('brick-side-studs-1x4', 'yellow', 1, 6, 1),
    makeBrick('tile-eye-1x1', 'white', 2, 6.1, 0.6, 0, 1),
    makeBrick('tile-eye-1x1', 'white', 3, 6.1, 0.6, 0, 1),
    makeBrick('plate-1x4', 'blue', 1, 7.2, 1),
    makeBrick('brick-round-1x1', 'cyan', 2, 7.6, 1),
    makeBrick('round-1x1-plate', 'red', 2, 8.8, 1),
  ]
  return assemblePlan('机器人', prompt, bricks, imageName)
}

const animalPlan = (prompt: string, imageName?: string) => {
  const bricks = [
    makeBrick('plate-4x6', 'blue', 0, 0, 0),
    makeBrick('slope-cheese-1x1', 'orange', 2, 0.4, 0),
    makeBrick('slope-cheese-1x1', 'orange', 3, 0.4, 0, 2),
    makeBrick('brick-2x4', 'yellow', 1, 0.4, 1),
    makeBrick('plate-2x4', 'yellow', 1, 1.6, 1),
    makeBrick('slope-1x2', 'yellow', 0, 2, 2),
    makeBrick('slope-cheese-1x1', 'yellow', 2, 2, 2, 1),
    makeBrick('slope-cheese-1x1', 'yellow', 3, 2, 2, 3),
    makeBrick('brick-side-studs-1x4', 'yellow', 1, 2, 1),
    makeBrick('round-1x1-plate', 'orange', 2, 2.1, 0.6, 0, 1),
    makeBrick('round-1x1-plate', 'orange', 3, 2.1, 0.6, 0, 1),
    makeBrick('brick-side-studs-1x4', 'yellow', 1, 3.2, 1),
    makeBrick('tile-eye-1x1', 'white', 2, 3.3, 0.6, 0, 1),
    makeBrick('tile-eye-1x1', 'white', 3, 3.3, 0.6, 0, 1),
    makeBrick('round-1x1-plate', 'blue', 0, 0.4, 3),
    makeBrick('round-1x1-plate', 'cyan', 5, 0.4, 3),
  ]
  return assemblePlan('小鸭子', prompt, bricks, imageName)
}

export const generateBuildPlan = ({ prompt, imageName }: GeneratorInput): BuildPlan => {
  const normalized = prompt.toLowerCase()

  if (/ghost|幽灵/.test(normalized)) return ghostPlan(prompt, imageName)
  if (/car|truck|vehicle|车|汽车|卡车/.test(normalized)) return carPlan(prompt, imageName)
  if (/house|home|building|房|屋|建筑/.test(normalized)) return housePlan(prompt, imageName)
  if (/bridge|桥/.test(normalized)) return bridgePlan(prompt, imageName)
  if (/bench|chair|seat|椅|长椅|座椅/.test(normalized)) return benchPlan(prompt, imageName)
  if (/castle|gate|tower|城堡|门楼|塔/.test(normalized)) return castlePlan(prompt, imageName)
  if (/rocket|spaceship|火箭|飞船/.test(normalized)) return rocketPlan(prompt, imageName)
  if (/flower|pot|花|花盆/.test(normalized)) return flowerPlan(prompt, imageName)
  if (/tree|plant|flower|树|植物|花/.test(normalized)) return treePlan(prompt, imageName)
  if (/robot|mecha|机器人|机甲/.test(normalized)) return robotPlan(prompt, imageName)
  if (/duck|bird|dog|cat|animal|bear|鸭|小鸭|鸟|动物|狗|猫|熊/.test(normalized)) return animalPlan(prompt, imageName)

  return robotPlan(prompt || '一个基础积木模型', imageName)
}
