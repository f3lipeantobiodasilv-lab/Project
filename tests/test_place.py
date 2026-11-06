"""Structural checks for the generated place; run with python3 -m unittest discover -s tests."""
import base64
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def named(parent, name):
    for obj in parent.findall('Item'):
        if obj.findtext('./Properties/string[@name="Name"]') == name:
            return obj
    raise AssertionError(f'No child {name!r}')


class PlaceTest(unittest.TestCase):
    def setUp(self):
        self.root = ET.parse(ROOT / 'HybridGraphicsLab.rbxlx').getroot()

    def test_scene_and_tags(self):
        workspace = named(self.root, 'Workspace')
        self.assertEqual(workspace.findtext('./Properties/float[@name="Gravity"]'), '196.2')
        room = named(workspace, 'Sala de Teste de Graficos')
        targets = [child for child in room.findall('Item') if child.find('./Properties/BinaryString[@name="Tags"]') is not None]
        self.assertEqual(len(targets), 4)
        for target in targets:
            self.assertEqual(base64.b64decode(target.findtext('./Properties/BinaryString[@name="Tags"]')), b'RayTraceTarget')
        self.assertEqual([x.findtext('./Properties/token[@name="shape"]') for x in targets], ['1', '0', '0', '0'])
        self.assertEqual(named(room, 'SpawnLocation').get('class'), 'SpawnLocation')
        self.assertEqual(named(self.root, 'Players').findtext('./Properties/bool[@name="CharacterAutoLoads"]'), 'true')

    def test_scripts_match_sources(self):
        shared = named(named(self.root, 'ReplicatedStorage'), 'GraphicsShared')
        for name in ('RayMath', 'PipelineConfig', 'Types'):
            source = (ROOT / f'src/ReplicatedStorage/GraphicsShared/{name}.luau').read_text()
            self.assertTrue(source.startswith('--!strict'))
            self.assertEqual(named(shared, name).findtext('./Properties/ProtectedString[@name="Source"]'), source)
        scripts = named(named(self.root, 'StarterPlayer'), 'StarterPlayerScripts')
        source = (ROOT / 'src/StarterPlayer/StarterPlayerScripts/HybridPipelineController.client.luau').read_text()
        self.assertTrue(source.startswith('--!strict'))
        self.assertEqual(named(scripts, 'HybridPipelineController').findtext('./Properties/ProtectedString[@name="Source"]'), source)
        self.assertEqual(named(named(self.root, 'StarterGui'), 'HybridHUD').get('class'), 'ScreenGui')

    def test_referents_and_rojo_paths(self):
        items = list(self.root.iter('Item'))
        self.assertEqual(len({item.get('referent') for item in items}), len(items))
        project = json.loads((ROOT / 'default.project.json').read_text())
        def check_paths(value):
            if isinstance(value, dict):
                if '$path' in value: self.assertTrue((ROOT / value['$path']).exists(), value['$path'])
                for child in value.values(): check_paths(child)
            elif isinstance(value, list):
                for child in value: check_paths(child)
        check_paths(project)


if __name__ == '__main__':
    unittest.main()
