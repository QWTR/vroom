import * as THREE from 'three';

type PhysicalLike = THREE.MeshStandardMaterial & {
  transmission?: number;
  thickness?: number;
  clearcoat?: number;
};

/** expo-gl nie obsługuje renderbufferStorageMultisample — wyłącz transmission / physical. */
export function sanitizeGlbForExpoGl(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const convert = (mat: THREE.Material): THREE.Material => {
      const physical = mat as PhysicalLike;
      if ((physical as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        mat.dispose?.();
        return toStandardMaterial(physical);
      }

      const needsReplace =
        (physical.transmission ?? 0) > 0
        || (physical.thickness ?? 0) > 0;

      if (needsReplace) {
        mat.dispose?.();
        return toStandardMaterial(physical);
      }

      physical.transparent = false;
      physical.opacity = 1;
      physical.depthWrite = true;
      return physical;
    };

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(convert);
    } else if (mesh.material) {
      mesh.material = convert(mesh.material);
    }
    mesh.frustumCulled = false;
  });
}

function toStandardMaterial(src: PhysicalLike): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: src.color?.clone?.() ?? new THREE.Color(0xb0b0b0),
    map: src.map ?? null,
    metalness: Number.isFinite(src.metalness) ? src.metalness : 0.45,
    roughness: Number.isFinite(src.roughness) ? src.roughness : 0.5,
    normalMap: src.normalMap ?? null,
    aoMap: src.aoMap ?? null,
    emissive: src.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 0,
    transparent: false,
    opacity: 1,
    depthWrite: true,
  });
}
