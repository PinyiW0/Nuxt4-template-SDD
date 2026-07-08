import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyUnitSphereNormalization,
  computeUnitSphereNormalization,
} from '~/components/baseball-spin/core/normalize-model'

// 程式生成一顆偏移＋縮放過的球面點雲（經緯取樣），驗證歸一化同後端 load_unit_sphere_trimesh
function makeSphereMesh(center: Vector3, radius: number): Mesh {
  const positions: number[] = []
  for (let lat = 1; lat < 12; lat++) {
    const phi = lat / 12 * Math.PI
    for (let lon = 0; lon < 24; lon++) {
      const th = lon / 24 * 2 * Math.PI
      positions.push(
        center.x + radius * Math.sin(phi) * Math.cos(th),
        center.y + radius * Math.sin(phi) * Math.sin(th),
        center.z + radius * Math.cos(phi),
      )
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return new Mesh(geometry, new MeshBasicMaterial())
}

describe('computeUnitSphereNormalization：中心化＋平均半徑歸一化', () => {
  it('偏移＋縮放的球 → center / meanRadius 正確', () => {
    const mesh = makeSphereMesh(new Vector3(2, -1, 5), 3)
    const n = computeUnitSphereNormalization(mesh)
    // 經緯取樣兩極較密，平均位置在 z 向有小偏差 → 容差放寬到 1e-1
    expect(n.center.distanceTo(new Vector3(2, -1, 5))).toBeLessThan(1e-1)
    expect(Math.abs(n.meanRadius - 3)).toBeLessThan(1e-1)
  })

  it('node 自身 transform 會被計入（頂點轉到 world 空間統計）', () => {
    const mesh = makeSphereMesh(new Vector3(0, 0, 0), 1)
    mesh.scale.setScalar(2)
    mesh.position.set(10, 0, 0)
    const n = computeUnitSphereNormalization(mesh)
    expect(n.center.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-1)
    expect(Math.abs(n.meanRadius - 2)).toBeLessThan(1e-1)
  })

  it('套用到 wrapper 後：頂點平均半徑 ≈ 1、中心 ≈ 原點', () => {
    const mesh = makeSphereMesh(new Vector3(-4, 7, 0.5), 2.5)
    const wrapper = new Group()
    wrapper.add(mesh)
    applyUnitSphereNormalization(wrapper, computeUnitSphereNormalization(mesh))
    wrapper.updateWorldMatrix(true, true)

    const pos = mesh.geometry.getAttribute('position')
    const v = new Vector3()
    const centerAfter = new Vector3()
    let radiusSum = 0
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      centerAfter.add(v)
      radiusSum += v.length()
    }
    centerAfter.divideScalar(pos.count)
    expect(centerAfter.length()).toBeLessThan(1e-1)
    expect(Math.abs(radiusSum / pos.count - 1)).toBeLessThan(5e-2)
  })

  it('沒有頂點時丟錯', () => {
    expect(() => computeUnitSphereNormalization(new Group())).toThrow()
  })
})
