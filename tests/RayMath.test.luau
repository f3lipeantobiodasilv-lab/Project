--!strict
-- Run with the standalone Luau CLI. A tiny vector shim exercises the real module.
local RayMath = require("../src/ReplicatedStorage/GraphicsShared/RayMath")
local Vec = {}
Vec.__index = Vec
function Vec.new(x: number, y: number, z: number): any
    return setmetatable({X = x, Y = y, Z = z}, Vec)
end
function Vec:Dot(b: any): number return self.X * b.X + self.Y * b.Y + self.Z * b.Z end
function Vec.__add(a: any, b: any): any return Vec.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
function Vec.__sub(a: any, b: any): any return Vec.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
function Vec.__mul(a: any, b: any): any
    if type(a) == "number" then return Vec.new(a * b.X, a * b.Y, a * b.Z) end
    return Vec.new(a.X * b, a.Y * b, a.Z * b)
end
local function close(a: number?, b: number)
    assert(a ~= nil and math.abs(a - b) < 1e-6, tostring(a) .. " ~= " .. tostring(b))
end
local origin, forward = Vec.new(0, 0, 0), Vec.new(0, 0, -1)
close(RayMath.sphere(origin, forward, Vec.new(0, 0, -5), 1), 4)
close(RayMath.sphere(Vec.new(0, 0, -5), forward, Vec.new(0, 0, -5), 1), 1)
close(RayMath.sphere(origin, Vec.new(0, 0, -2), Vec.new(0, 0, -5), 1), 2)
close(RayMath.sphere(origin, forward, Vec.new(1, 0, -5), 1), 5) -- tangent
assert(RayMath.sphere(origin, forward, Vec.new(0, 0, 5), 1) == nil)
assert(RayMath.sphere(origin, Vec.new(0, 0, 0), origin, 1) == nil)
close(RayMath.plane(Vec.new(0, 2, 0), Vec.new(0, -1, 0), origin, Vec.new(0, 1, 0)), 2)
assert(RayMath.plane(origin, forward, origin, Vec.new(0, 1, 0)) == nil)
assert(RayMath.plane(Vec.new(0, 2, 0), Vec.new(0, 1, 0), origin, Vec.new(0, 1, 0)) == nil)
local reflected = RayMath.reflect(Vec.new(1, -1, 0), Vec.new(0, 1, 0))
close(reflected.X, 1); close(reflected.Y, 1); close(reflected.Z, 0)
local angled = RayMath.reflect(Vec.new(1, 0, 0), Vec.new(math.sqrt(0.5), math.sqrt(0.5), 0))
close(angled.X, 0); close(angled.Y, -1); close(angled.Z, 0)
print("RayMath: 12 interseções/reflexões verificadas")
