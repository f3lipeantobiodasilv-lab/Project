#!/usr/bin/env python3
"""Deterministic offline XML place builder for this project (no Studio/assets needed).
The same scene and scripts are also consumed by default.project.json with Rojo.
"""
from pathlib import Path
import base64
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SCENE = ROOT / 'src/Workspace/Sala.rbxmx'

def prop(item, kind, name, value):
    props = item.find('Properties')
    assert props is not None
    el = ET.SubElement(props, kind, {'name': name})
    el.text = str(value)
    return el

def item(parent, cls, name):
    obj = ET.SubElement(parent, 'Item', {'class': cls})
    ET.SubElement(obj, 'Properties')
    prop(obj, 'string', 'Name', name)
    return obj

def vector(obj, kind, name, xyz):
    el = prop(obj, kind, name, '')
    for key, value in zip(('X', 'Y', 'Z'), xyz): ET.SubElement(el, key).text = str(value)

def part(parent, name, position, size, color, *, cls='Part', shape=1, material=256, reflectance=0, tag=False, transparency=0):
    obj = item(parent, cls, name)
    prop(obj, 'bool', 'Anchored', 'true')
    prop(obj, 'bool', 'CanCollide', 'true')
    frame = prop(obj, 'CoordinateFrame', 'CFrame', '')
    for key, value in zip(('X', 'Y', 'Z'), position): ET.SubElement(frame, key).text = str(value)
    for row in range(3):
        for col in range(3): ET.SubElement(frame, f'R{row}{col}').text = str(int(row == col))
    vector(obj, 'Vector3', 'size', size)
    prop(obj, 'Color3uint8', 'Color3uint8', (255 << 24) | (color[0] << 16) | (color[1] << 8) | color[2])
    prop(obj, 'token', 'shape', shape)
    prop(obj, 'token', 'Material', material)
    prop(obj, 'token', 'TopSurface', 0)
    prop(obj, 'token', 'BottomSurface', 0)
    prop(obj, 'float', 'Reflectance', reflectance)
    prop(obj, 'float', 'Transparency', transparency)
    if tag: prop(obj, 'BinaryString', 'Tags', base64.b64encode(b'RayTraceTarget').decode())
    if cls == 'SpawnLocation':
        prop(obj, 'bool', 'Enabled', 'true')
        prop(obj, 'bool', 'Neutral', 'true')
        prop(obj, 'int', 'Duration', 0)
    return obj

def make_scene():
    doc = ET.Element('roblox', {'version': '4'})
    room = item(doc, 'Model', 'Sala de Teste de Graficos')
    part(room, 'MirrorFloor', (0, -0.5, 0), (48, 1, 48), (101, 112, 128), material=1088, reflectance=0.25, tag=True)
    part(room, 'Esfera Coral', (-6, 3, -1), (6, 6, 6), (255, 68, 100), shape=0, material=288, tag=True)
    part(room, 'Esfera Azul', (0, 3, -4), (6, 6, 6), (51, 160, 255), shape=0, material=288, tag=True)
    part(room, 'Esfera Dourada', (6, 3, -1), (6, 6, 6), (255, 200, 65), shape=0, material=288, tag=True)
    part(room, 'Parede de Fundo', (0, 7, -24), (48, 14, 1), (36, 43, 60))
    part(room, 'Parede Esquerda', (-24, 7, 0), (1, 14, 48), (43, 51, 68))
    part(room, 'Parede Direita', (24, 7, 0), (1, 14, 48), (43, 51, 68))
    part(room, 'SpawnLocation', (0, 0.1, 18), (5, 0.2, 5), (128, 144, 160), cls='SpawnLocation')
    return doc

def write_xml(root, path):
    # Studio XML uses unique referents; reassign after composing the scene.
    for index, obj in enumerate(root.iter('Item'), 1):
        obj.set('referent', f'RBX{index:032X}')
    ET.indent(root, space='  ')
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True, short_empty_elements=True)

# Regenerate the checked-in scene model from the concise source above.
write_xml(make_scene(), SCENE)
doc = ET.Element('roblox', {'version': '4'})
workspace = item(doc, 'Workspace', 'Workspace')
prop(workspace, 'float', 'Gravity', '196.2')
workspace.append(ET.parse(SCENE).getroot().find('Item'))
players = item(doc, 'Players', 'Players')
prop(players, 'bool', 'CharacterAutoLoads', 'true')
replicated = item(doc, 'ReplicatedStorage', 'ReplicatedStorage')
shared = item(replicated, 'Folder', 'GraphicsShared')
for name in ('Types', 'PipelineConfig', 'RayMath'):
    module = item(shared, 'ModuleScript', name)
    prop(module, 'ProtectedString', 'Source', (ROOT / f'src/ReplicatedStorage/GraphicsShared/{name}.luau').read_text())
starter_gui = item(doc, 'StarterGui', 'StarterGui')
hud = item(starter_gui, 'ScreenGui', 'HybridHUD')
prop(hud, 'bool', 'ResetOnSpawn', 'false')
prop(hud, 'bool', 'IgnoreGuiInset', 'true')
starter_player = item(doc, 'StarterPlayer', 'StarterPlayer')
player_scripts = item(starter_player, 'StarterPlayerScripts', 'StarterPlayerScripts')
controller = item(player_scripts, 'LocalScript', 'HybridPipelineController')
prop(controller, 'ProtectedString', 'Source', (ROOT / 'src/StarterPlayer/StarterPlayerScripts/HybridPipelineController.client.luau').read_text())
write_xml(doc, ROOT / 'HybridGraphicsLab.rbxlx')
print('Generated src/Workspace/Sala.rbxmx and HybridGraphicsLab.rbxlx')
