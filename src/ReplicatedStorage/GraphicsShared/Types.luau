--!strict
-- Shared structural types for the analytic subset. Directions are unit vectors.
export type Ray = { origin: Vector3, direction: Vector3 }
export type Sphere = { part: BasePart, center: Vector3, radius: number, color: Color3 }
export type Plane = { part: BasePart, cframe: CFrame, size: Vector3, color: Color3 }
export type Hit = { distance: number, point: Vector3, normal: Vector3, part: BasePart, color: Color3, isFloor: boolean }
export type Quality = { width: number, height: number, samples: number, bounces: number, interval: number }
return {}
