import { Box3, Sphere, type InterleavedBufferAttribute } from 'three'
import { LineSegmentsGeometry } from 'three-stdlib'

/** Immutable packed endpoints need one bounds scan; the box sphere is conservative. */
export class LDrawLineGeometry extends LineSegmentsGeometry {
  override computeBoundingBox() {
    const start = this.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined
    this.boundingBox ??= new Box3()
    if (!start) { this.boundingBox.makeEmpty(); return }
    this.boundingBox.setFromArray(start.data.array)
  }

  override computeBoundingSphere() {
    this.boundingSphere ??= new Sphere()
    if (!this.boundingBox) this.computeBoundingBox()
    this.boundingBox!.getBoundingSphere(this.boundingSphere)
  }
}
