import type { Object3D } from 'three'
import { Mesh, Vector3 } from 'three'

// 複製後端 load_unit_sphere_trimesh 的歸一化：頂點中心化＋除以「平均頂點半徑」→ 單位球。
// 不改頂點資料，回傳參數由呼叫端套在 wrapper Group：
//   scale = 1/meanRadius、position = -center/meanRadius（等價 (v - center) / r）
// 少了這步旋轉會偏擺（不繞球心）、構圖比例也對不上後端渲染。

export interface UnitSphereNormalization {
  center: Vector3
  meanRadius: number
}

export function computeUnitSphereNormalization(root: Object3D): UnitSphereNormalization {
  root.updateWorldMatrix(true, true)

  const v = new Vector3()
  const center = new Vector3()
  let count = 0

  // 第一遍：頂點（轉到 root 空間）的平均位置
  root.traverse((node) => {
    if (!(node instanceof Mesh))
      return
    const pos = node.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld)
      center.add(v)
      count++
    }
  })
  if (count === 0)
    throw new Error('模型內沒有任何頂點')
  center.divideScalar(count)

  // 第二遍：中心化後的平均半徑
  let radiusSum = 0
  root.traverse((node) => {
    if (!(node instanceof Mesh))
      return
    const pos = node.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld)
      radiusSum += v.sub(center).length()
    }
  })
  const meanRadius = radiusSum / count

  return { center, meanRadius }
}

// 把歸一化參數套到承載 glb 的 wrapper（p' = s·v + t）
export function applyUnitSphereNormalization(wrapper: Object3D, n: UnitSphereNormalization): void {
  const s = 1 / n.meanRadius
  wrapper.scale.setScalar(s)
  wrapper.position.copy(n.center).multiplyScalar(-s)
}
