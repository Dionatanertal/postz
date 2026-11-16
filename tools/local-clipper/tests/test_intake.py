import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('local_intake', Path(__file__).with_name('intake.py'))
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


class IntakeTests(unittest.TestCase):
    def probe(self, w=720, h=1280, d=48.6, audio=True):
        streams = [{'codec_type': 'video', 'codec_name': 'h264', 'width': w, 'height': h}]
        if audio:
            streams.append({'codec_type': 'audio', 'codec_name': 'aac'})
        return {'streams': streams, 'format': {'duration': str(d)}}

    def test_short_vertical_requires_review(self):
        self.assertEqual(intake.classify_probe(self.probe())['category'], 'short_vertical_review')

    def test_long_landscape_is_source(self):
        self.assertEqual(intake.classify_probe(self.probe(1920, 1080, 1850))['category'], 'clip_source_review')

    def test_audio_missing(self):
        self.assertTrue(any('Sem áudio' in n for n in intake.classify_probe(self.probe(audio=False))['notes']))

    def test_broken_metadata_fails(self):
        with self.assertRaises(ValueError):
            intake.classify_probe(self.probe(d=0))

    def test_no_video_fails(self):
        with self.assertRaises(ValueError):
            intake.classify_probe({'streams': [], 'format': {'duration': '3'}})


if __name__ == '__main__':
    unittest.main()
