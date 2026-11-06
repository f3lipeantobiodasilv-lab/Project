--!strict
return table.freeze({
    Tag = "RayTraceTarget",
    Epsilon = 0.015,
    MaxDistance = 160,
    AmbientRadius = 8,
    -- Virtual area light, deliberately independent from the native renderer.
    LightPosition = Vector3.new(-4, 18, 9),
    LightRadius = 4,
    Low = table.freeze({ width = 32, height = 18, samples = 2, bounces = 1, interval = 1 / 15 }),
    High = table.freeze({ width = 48, height = 27, samples = 5, bounces = 2, interval = 1 / 15 }),
})
