"""python3 -m unittest test_crawl  (does not need Crawl4AI or a network)"""
import json
import tempfile
import unittest
from pathlib import Path

from crawl import contact_pages, extract_emails, place_from_entry, read_results, social_links, whatsapp_links


class ExtractionTest(unittest.TestCase):
    def test_emails_from_text_links_and_spelled_out_addresses(self):
        page = '<a href="mailto:Achat@Shop.fr?subject=Devis">Écrire</a> contact&#64;shop.fr · info [at] shop [dot] fr · logo@2x.png.'
        self.assertEqual(extract_emails(page, "Contact: contact@shop.fr."), ["achat@shop.fr", "contact@shop.fr", "logo@2x.png", "info@shop.fr"])

    def test_whatsapp_and_social_links(self):
        page = 'Écrivez-nous <a href="https://wa.me/33612345678">WhatsApp</a> ou https://api.whatsapp.com/send?phone=+971501234567'
        self.assertEqual(whatsapp_links(page), ["https://wa.me/33612345678", "https://wa.me/971501234567"])
        self.assertEqual(social_links(["https://www.facebook.com/dupont", "https://facebook.com/", "https://instagram.com/dupont_meubles", "https://shop.fr/x"]),
                         {"facebook": "https://www.facebook.com/dupont", "instagram": "https://instagram.com/dupont_meubles"})

    def test_contact_pages_on_the_same_site_shortest_first(self):
        links = ["https://www.shop.fr/nous-contacter", "https://www.shop.fr/blog/contact-presse-2024", "https://other.fr/contact",
                 "https://shop.fr/a-propos#equipe", "https://www.shop.fr/canapes"]
        self.assertEqual(contact_pages("https://www.shop.fr", links), ["https://shop.fr/a-propos", "https://www.shop.fr/nous-contacter"])

    def test_scraper_entries_of_either_version(self):
        entry = {"input_id": "s1", "data_id": "0x1:0x2", "title": " Meubles Dupont ", "category": "Magasin de meubles", "address": "1 rue X, Lyon",
                 "web_site": "https://shop.fr", "phone": "04 78 00 00 01", "review_rating": 4.6, "review_count": 120,
                 "complete_address": {"city": "Lyon"}, "emails": ["achat@shop.fr"]}
        place = place_from_entry(entry)
        self.assertEqual((place["placeKey"], place["name"], place["city"], place["website"], place["_inputId"]), ("0x1:0x2", "Meubles Dupont", "Lyon", "https://shop.fr", "s1"))
        self.assertEqual(place["emails"], [{"address": "achat@shop.fr", "foundOn": "google-maps-scraper"}])
        self.assertIsNone(place_from_entry({"title": "No key"}))
        self.assertEqual(place_from_entry({"cid": "9", "title": "X", "categories": ["A", "B"], "website": "x.fr"})["category"], "A, B")

    def test_results_as_array_or_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            array, lines = Path(folder) / "a.json", Path(folder) / "b.json"
            array.write_text(json.dumps([{"cid": "1"}, {"cid": "2"}]))
            lines.write_text('{"cid": "1"}\n{"cid": "2"}\n')
            self.assertEqual(read_results(array), [{"cid": "1"}, {"cid": "2"}])
            self.assertEqual(read_results(lines), [{"cid": "1"}, {"cid": "2"}])


if __name__ == "__main__":
    unittest.main()
