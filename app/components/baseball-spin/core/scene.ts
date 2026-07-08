import type { Object3D, Quaternion, Vector3 } from 'three'
import type { SpinResult } from './types'
import type { SpinViewPreset } from './views'
import {
  AmbientLight,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  Texture,
  Vector3 as Vec3Cls,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyUnitSphereNormalization, computeUnitSphereNormalization } from './normalize-model'
import { angularSpeedRadPerSec, attitudeAt, rotationMatrixToQuaternion, spinAxis } from './spin-math'
import { resolveViewConfig } from './views'

export interface SceneOptions {
  view?: SpinViewPreset
  /** 播放速度倍率，1 = 真實轉速；對照後端 gif 用 1/8 */
  speed?: number
  /** devicePixelRatio 上限，避免高 DPI 螢幕過度渲染 */
  pixelRatioCap?: number
}

const _up = new Vec3Cls(0, 1, 0)

// three 場景封裝（框架無關）：
// 場景圖 spinGroup（每幀套姿態）→ normalizeGroup（單位球歸一化）→ glb root，
// 旋轉在外層、歸一化在內層，保證繞球心自轉。
export class BaseballSpinScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera: OrthographicCamera
  private spinGroup = new Group()
  private lastTime = 0
  private container: HTMLElement
  private halfExtent: number

  private modelRoot: Object3D | null = null
  private axisArrow: Group | null = null
  private axisArrowVisible = true
  private qRef: Quaternion | null = null
  private axisSigned: Vector3 | null = null
  private radPerSec = 0
  private theta = 0
  private speed: number
  private rafId = 0
  private playing = false
  private disposed = false

  constructor(container: HTMLElement, opts: SceneOptions = {}) {
    this.container = container
    this.speed = opts.speed ?? 1

    const view = resolveViewConfig(opts.view ?? 'camera')
    this.halfExtent = view.orthoHalfExtent

    // 透明底對齊後端 gif；NoToneMapping 減少與 pyrender 的明暗變數
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.toneMapping = NoToneMapping
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.pixelRatioCap ?? 2))
    container.appendChild(this.renderer.domElement)

    this.camera = new OrthographicCamera()
    this.camera.position.set(...view.cameraPosition)
    this.camera.up.set(...view.up)
    this.camera.lookAt(0, 0, 0)

    // 後端 ambient 0.10；主光與相機同側，讓縫線清晰可辨
    this.scene.add(new AmbientLight(0xFFFFFF, 1.2))
    const key = new DirectionalLight(0xFFFFFF, 2.2)
    key.position.set(0.5, 1, 2)
    this.scene.add(key)

    this.scene.add(this.spinGroup)
    this.resize()
  }

  // 載入 glb 並做單位球歸一化（同後端 load_unit_sphere_trimesh）
  async loadModel(url: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      onProgress?.(e.loaded, e.total)
    })
    if (this.disposed) {
      disposeObject(gltf.scene)
      return
    }
    if (this.modelRoot) {
      this.spinGroup.remove(this.modelRoot)
      disposeObject(this.modelRoot)
    }

    const normalizeGroup = new Group()
    normalizeGroup.add(gltf.scene)
    applyUnitSphereNormalization(normalizeGroup, computeUnitSphereNormalization(gltf.scene))

    this.modelRoot = normalizeGroup
    this.spinGroup.add(normalizeGroup)
    this.renderFrame()
  }

  // 套用一球的資料：預計算姿態參數並回到 θ=0
  setData(result: SpinResult): void {
    this.qRef = rotationMatrixToQuaternion(result.animation.rRef)
    this.axisSigned = spinAxis(result.axis, result.animation.omegaRadPerFrame)
    this.radPerSec = angularSpeedRadPerSec(result.animation)
    this.theta = 0
    this.updateAxisArrow()
    this.applyAttitude()
    this.renderFrame()
  }

  // 顯示／隱藏 3D 軸箭頭
  setAxisArrowVisible(visible: boolean): void {
    this.axisArrowVisible = visible
    if (this.axisArrow)
      this.axisArrow.visible = visible
    this.renderFrame()
  }

  play(): void {
    if (this.playing || this.disposed)
      return
    this.playing = true
    this.lastTime = performance.now()
    const tick = (): void => {
      if (!this.playing)
        return
      // 用時間累加角度（非幀數），螢幕 Hz 與 rAF 節流不影響角速度
      const now = performance.now()
      const delta = (now - this.lastTime) / 1000
      this.lastTime = now
      this.theta = (this.theta + delta * this.radPerSec * this.speed) % (2 * Math.PI)
      this.applyAttitude()
      this.renderFrame()
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.rafId)
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier
  }

  get isPlaying(): boolean {
    return this.playing
  }

  // 依容器尺寸重算正交 frustum（維持 halfExtent 對映後端 xmag）
  resize(): void {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const aspect = w / h
    const e = this.halfExtent
    this.camera.left = -e * aspect
    this.camera.right = e * aspect
    this.camera.top = e
    this.camera.bottom = -e
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.renderFrame()
  }

  dispose(): void {
    this.pause()
    this.disposed = true
    disposeObject(this.scene)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  private applyAttitude(): void {
    if (!this.qRef || !this.axisSigned)
      return
    attitudeAt(this.qRef, this.axisSigned, this.theta, this.spinGroup.quaternion)
  }

  // 3D 軸箭頭（同後端 set_rotation_axis：全長 4r、桿半徑 0.035、單頭）。
  // 軸固定在相機系（球轉、軸不轉），加在 scene 而非 spinGroup；遮蔽交給深度緩衝。
  private updateAxisArrow(): void {
    if (!this.axisSigned)
      return
    if (!this.axisArrow) {
      this.axisArrow = buildAxisArrow()
      this.scene.add(this.axisArrow)
    }
    // 幾何以 +Y 為軸向，轉到自轉軸方向（箭頭指向帶號軸正端）
    this.axisArrow.quaternion.setFromUnitVectors(_up, this.axisSigned)
    this.axisArrow.visible = this.axisArrowVisible
  }

  private renderFrame(): void {
    if (!this.disposed)
      this.renderer.render(this.scene, this.camera)
  }
}

// 黃色 3D 箭頭：圓柱桿（−2r 到頭錐底）＋ 圓錐頭（尖端在 +2r），沿 +Y
function buildAxisArrow(): Group {
  const material = new MeshStandardMaterial({ color: 0xFACC15, roughness: 0.55 })
  const headLen = 0.4
  const shaft = new Mesh(new CylinderGeometry(0.035, 0.035, 4 - headLen), material)
  shaft.position.y = -headLen / 2
  const head = new Mesh(new ConeGeometry(0.12, headLen), material)
  head.position.y = 2 - headLen / 2
  const group = new Group()
  group.add(shaft, head)
  return group
}

// 釋放物件樹的 geometry / material / texture，避免 WebGL 資源洩漏
function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh))
      return
    node.geometry.dispose()
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture)
          value.dispose()
      }
      material.dispose()
    }
  })
}
