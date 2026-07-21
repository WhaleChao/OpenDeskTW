from pathlib import Path
import sys

from openpyxl import Workbook
from openpyxl.styles import Font


output_directory = Path(sys.argv[1])
output_directory.mkdir(parents=True, exist_ok=True)

workbook = Workbook()
workbook.properties.creator = "OpenDesk TW"
workbook.properties.title = "空白試算表"
workbook.properties.subject = "OpenDesk TW 繁體中文空白試算表範本"
worksheet = workbook.active
worksheet.title = "工作表1"
worksheet.sheet_view.showGridLines = True
worksheet.sheet_properties.pageSetUpPr.fitToPage = False
workbook._named_styles["Normal"].font = Font(name="Noto Sans CJK TC", size=11)
workbook.calculation.fullCalcOnLoad = True
workbook.calculation.forceFullCalc = True
workbook.calculation.calcMode = "auto"
workbook.save(output_directory / "Blank-Spreadsheet.xlsx")
