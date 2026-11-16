import importlib.util
from pathlib import Path
import sys
import unittest

module_path = Path(__file__).resolve().parents[1] / 'verify_output.py'
spec = importlib.util.spec_from_file_location('postz_verify_output', module_path)
verify = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = verify
spec.loader.exec_module(verify)


def metadata(width=720, height=1280, duration='44.0', audio=True):
    streams = [{'codec_type': 'video', 'codec_name': 'h264', 'width': width, 'height': height}]
    if audio:
        streams.append({'codec_type': 'audio', 'codec_name': 'aac'})
    return {'streams': streams, 'format': {'duration': duration}}


class OutputGateTests(unittest.TestCase):
    def test_accepts_standard_vertical_clip(self):
        result = verify.check_metadata(metadata())
        self.assertTrue(result['passed_technical_checks'])
        self.assertEqual(result['editorial_approval'], 'NOT_EVALUATED')

    def test_rejects_landscape(self):
        self.assertFalse(verify.check_metadata(metadata(1280, 720))['passed_technical_checks'])

    def test_rejects_missing_audio(self):
        result = verify.check_metadata(metadata(audio=False))
        self.assertFalse(result['passed_technical_checks'])
        self.assertTrue(any('audio' in e.lower() for e in result['errors']))

    def test_rejects_excess_duration(self):
        self.assertFalse(verify.check_metadata(metadata(duration='190.0'))['passed_technical_checks'])

    def test_rejects_invalid_duration(self):
        self.assertFalse(verify.check_metadata(metadata(duration='nan'))['passed_technical_checks'])

    def test_warns_other_codecs_without_false_approval(self):
        data = metadata()
        data['streams'][0]['codec_name'] = 'hevc'
        result = verify.check_metadata(data)
        self.assertTrue(result['warnings'])
        self.assertEqual(result['editorial_approval'], 'NOT_EVALUATED')


if __name__ == '__main__':
    unittest.main()
