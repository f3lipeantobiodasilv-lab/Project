--!strict
local RayMath = {}
local EPSILON = 1e-5

-- Works for non-unit directions too; returns the nearest positive ray parameter.
function RayMath.sphere(origin: Vector3, direction: Vector3, center: Vector3, radius: number): number?
    local offset = origin - center
    local a = direction:Dot(direction)
    if a < EPSILON then return nil end
    local halfB = offset:Dot(direction)
    local discriminant = halfB * halfB - a * (offset:Dot(offset) - radius * radius)
    if discriminant < 0 then return nil end
    local root = math.sqrt(discriminant)
    local near = (-halfB - root) / a
    local far = (-halfB + root) / a
    if near > EPSILON then return near end
    if far > EPSILON then return far end
    return nil
end

-- Infinite plane; finite bounds are checked separately in local space.
function RayMath.plane(origin: Vector3, direction: Vector3, point: Vector3, normal: Vector3): number?
    local denominator = direction:Dot(normal)
    if math.abs(denominator) < EPSILON then return nil end
    local t = (point - origin):Dot(normal) / denominator
    if t > EPSILON then return t end
    return nil
end

function RayMath.reflect(incident: Vector3, normal: Vector3): Vector3
    return incident - 2 * incident:Dot(normal) * normal
end

return table.freeze(RayMath)
