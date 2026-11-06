--!strict
-- This is a deliberately low-resolution analytic overlay, not access to Roblox's
-- depth/color buffers. Native rendering remains visible wherever the overlay misses.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local Workspace = game:GetService("Workspace")

local shared = ReplicatedStorage:WaitForChild("GraphicsShared")
local RayMath = require(shared:WaitForChild("RayMath"))
local Config = require(shared:WaitForChild("PipelineConfig"))
-- Static module path lets Studio resolve the exported types in strict mode.
local Types = require(ReplicatedStorage.GraphicsShared.Types)
type Sphere = Types.Sphere
type Plane = Types.Plane
type Hit = Types.Hit
type Quality = Types.Quality

local player = Players.LocalPlayer
local gui = player:WaitForChild("PlayerGui"):WaitForChild("HybridHUD") :: ScreenGui
local canvas = Instance.new("Frame")
canvas.Name = "AnalyticCanvas"
canvas.Size = UDim2.fromScale(1, 1)
canvas.BackgroundTransparency = 1
canvas.BorderSizePixel = 0
canvas.ZIndex = 1
canvas.Parent = gui

local panel = Instance.new("Frame")
panel.Name = "Controls"
panel.Position = UDim2.fromOffset(16, 16)
panel.Size = UDim2.fromOffset(260, 110)
panel.BackgroundColor3 = Color3.fromRGB(19, 25, 39)
panel.BackgroundTransparency = 0.08
panel.BorderSizePixel = 0
panel.ZIndex = 5
panel.Parent = gui
local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 10)
corner.Parent = panel
local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -20, 0, 28)
title.Position = UDim2.fromOffset(10, 4)
title.Text = "HYBRID GRAPHICS LAB"
title.TextColor3 = Color3.fromRGB(229, 239, 255)
title.TextSize = 14
title.Font = Enum.Font.GothamBold
title.TextXAlignment = Enum.TextXAlignment.Left
title.BackgroundTransparency = 1
title.ZIndex = 6
title.Parent = panel

local function button(x: number): TextButton
    local b = Instance.new("TextButton")
    b.Size = UDim2.fromOffset(112, 34)
    b.Position = UDim2.fromOffset(x, 39)
    b.BackgroundColor3 = Color3.fromRGB(44, 62, 89)
    b.TextColor3 = Color3.fromRGB(245, 248, 255)
    b.TextSize = 13
    b.Font = Enum.Font.GothamBold
    b.BorderSizePixel = 0
    b.ZIndex = 6
    b.Parent = panel
    local rounding = Instance.new("UICorner")
    rounding.CornerRadius = UDim.new(0, 6)
    rounding.Parent = b
    return b
end
local toggle = button(10)
local qualityButton = button(134)
local note = Instance.new("TextLabel")
note.Size = UDim2.new(1, -20, 0, 22)
note.Position = UDim2.fromOffset(10, 80)
note.BackgroundTransparency = 1
note.Text = "Raios analíticos • baixa resolução"
note.TextColor3 = Color3.fromRGB(164, 182, 206)
note.TextSize = 11
note.Font = Enum.Font.Gotham
note.TextXAlignment = Enum.TextXAlignment.Left
note.ZIndex = 6
note.Parent = panel

local enabled = true
local high = false
local quality: Quality = Config.Low
local pixels: {Frame} = {}
local function rebuild()
    canvas:ClearAllChildren()
    table.clear(pixels)
    for y = 0, quality.height - 1 do
        for x = 0, quality.width - 1 do
            local pixel = Instance.new("Frame")
            pixel.Name = "Pixel"
            pixel.Position = UDim2.fromScale(x / quality.width, y / quality.height)
            pixel.Size = UDim2.fromScale(1 / quality.width, 1 / quality.height)
            pixel.BorderSizePixel = 0
            pixel.BackgroundTransparency = 1
            pixel.ZIndex = 1
            pixel.Parent = canvas
            table.insert(pixels, pixel)
        end
    end
end
local function updateButtons()
    toggle.Text = if enabled then "EFEITO: ON" else "EFEITO: OFF"
    toggle.BackgroundColor3 = if enabled then Color3.fromRGB(29, 115, 104) else Color3.fromRGB(72, 75, 87)
    qualityButton.Text = if high then "QUALIDADE: ALTA" else "QUALIDADE: BAIXA"
end
rebuild()
updateButtons()
toggle.Activated:Connect(function()
    enabled = not enabled
    canvas.Visible = enabled
    updateButtons()
end)
qualityButton.Activated:Connect(function()
    high = not high
    quality = if high then Config.High else Config.Low
    rebuild()
    updateButtons()
end)

-- Snapshot tagged primitives once per update; geometry remains dynamic between updates.
local function collect(): ({Sphere}, {Plane})
    local spheres: {Sphere} = {}
    local planes: {Plane} = {}
    for _, instance in CollectionService:GetTagged(Config.Tag) do
        if instance:IsA("Part") and instance:IsDescendantOf(Workspace) then
            if instance.Shape == Enum.PartType.Ball then
                local size = instance.Size
                -- Only uniform spheres are analytic spheres, not ellipsoids.
                if math.abs(size.X - size.Y) < 0.01 and math.abs(size.X - size.Z) < 0.01 then
                    table.insert(spheres, {part = instance, center = instance.Position, radius = size.X / 2, color = instance.Color})
                end
            elseif instance.Shape == Enum.PartType.Block then
                table.insert(planes, {part = instance, cframe = instance.CFrame, size = instance.Size, color = instance.Color})
            end
        end
    end
    return spheres, planes
end

local function trace(origin: Vector3, direction: Vector3, spheres: {Sphere}, planes: {Plane}, limit: number): Hit?
    local nearest: Hit? = nil
    local distance = limit
    for _, sphere in spheres do
        local t = RayMath.sphere(origin, direction, sphere.center, sphere.radius)
        if t and t < distance then
            distance = t
            local point = origin + direction * t
            nearest = {distance = t, point = point, normal = (point - sphere.center).Unit, part = sphere.part, color = sphere.color, isFloor = false}
        end
    end
    for _, plane in planes do
        local normal = plane.cframe.UpVector
        -- The top face only; the side and bottom faces are not represented.
        if direction:Dot(normal) < -0.00001 then
            local pointOnPlane = plane.cframe.Position + normal * (plane.size.Y / 2)
            local t = RayMath.plane(origin, direction, pointOnPlane, normal)
            if t and t < distance then
                local point = origin + direction * t
                local localPoint = plane.cframe:PointToObjectSpace(point)
                if math.abs(localPoint.X) <= plane.size.X / 2 and math.abs(localPoint.Z) <= plane.size.Z / 2 then
                    distance = t
                    nearest = {distance = t, point = point, normal = normal, part = plane.part, color = plane.color, isFloor = true}
                end
            end
        end
    end
    return nearest
end

local function basis(normal: Vector3): (Vector3, Vector3)
    local helper = if math.abs(normal.Y) < 0.9 then Vector3.yAxis else Vector3.xAxis
    local tangent = normal:Cross(helper).Unit
    return tangent, normal:Cross(tangent).Unit
end

-- Fixed, stratified patterns avoid temporal noise and allocations from Random objects.
local function lighting(hit: Hit, spheres: {Sphere}, planes: {Plane}, samples: number): (number, number)
    local tangent, bitangent = basis(hit.normal)
    local start = hit.point + hit.normal * Config.Epsilon
    local occluded, blocked = 0, 0
    for i = 1, samples do
        local angle = i * 2.399963229728653
        local r = math.sqrt((i - 0.5) / samples)
        local dx, dy = math.cos(angle) * r, math.sin(angle) * r
        local ambientDirection = (tangent * dx + bitangent * dy + hit.normal * math.sqrt(1 - r * r)).Unit
        if trace(start, ambientDirection, spheres, planes, Config.AmbientRadius) then occluded += 1 end
        local light = Config.LightPosition + Vector3.new(dx * Config.LightRadius, 0, dy * Config.LightRadius)
        local toLight = light - start
        if toLight:Dot(hit.normal) <= 0 or trace(start, toLight.Unit, spheres, planes, toLight.Magnitude) then blocked += 1 end
    end
    return occluded / samples, blocked / samples
end

local function reflectedColor(hit: Hit, incoming: Vector3, spheres: {Sphere}, planes: {Plane}, bounces: number): Color3?
    local current = hit
    local direction = incoming
    local result: Color3? = nil
    for _ = 1, bounces do
        direction = RayMath.reflect(direction, current.normal).Unit
        local other = trace(current.point + current.normal * Config.Epsilon, direction, spheres, planes, Config.MaxDistance)
        if not other then break end
        -- Use the analytic object's color as a proxy for the unavailable raster buffer.
        local lightDir = (Config.LightPosition - other.point).Unit
        local brightness = 0.48 + 0.52 * math.max(0, other.normal:Dot(lightDir))
        local color = Color3.new(other.color.R * brightness, other.color.G * brightness, other.color.B * brightness)
        result = if result then result:Lerp(color, 0.25) else color
        current = other
    end
    return result
end

local elapsed = 0
RunService.RenderStepped:Connect(function(dt: number)
    if not enabled then return end
    elapsed += dt
    if elapsed < quality.interval then return end
    elapsed = 0
    local camera = Workspace.CurrentCamera
    if not camera or camera.ViewportSize.X <= 0 or camera.ViewportSize.Y <= 0 then return end
    local spheres, planes = collect()
    local viewport = camera.ViewportSize
    local fov = math.tan(math.rad(camera.FieldOfView) / 2)
    local aspect = viewport.X / viewport.Y
    local cf = camera.CFrame
    for y = 0, quality.height - 1 do
        for x = 0, quality.width - 1 do
            local px = ((x + 0.5) / quality.width * 2 - 1) * aspect * fov
            local py = (1 - (y + 0.5) / quality.height * 2) * fov
            local direction = (cf.LookVector + cf.RightVector * px + cf.UpVector * py).Unit
            local hit = trace(cf.Position, direction, spheres, planes, Config.MaxDistance)
            local pixel = pixels[y * quality.width + x + 1]
            if hit then
                local reflection = reflectedColor(hit, direction, spheres, planes, quality.bounces)
                local ao, shadow = lighting(hit, spheres, planes, quality.samples)
                local darkness = math.clamp(ao * 0.22 + shadow * 0.36, 0, 0.58)
                if reflection then
                    pixel.BackgroundColor3 = reflection:Lerp(Color3.new(0, 0, 0), darkness * 0.5)
                    pixel.BackgroundTransparency = if hit.isFloor then 0.30 else 0.55
                elseif darkness > 0.01 then
                    pixel.BackgroundColor3 = Color3.new(0, 0, 0)
                    pixel.BackgroundTransparency = 1 - darkness
                else
                    pixel.BackgroundTransparency = 1
                end
            else
                pixel.BackgroundTransparency = 1
            end
        end
    end
end)
