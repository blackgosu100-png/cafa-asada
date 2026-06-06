from pathlib import Path
import re

import pandas as pd


source = Path(r"C:\Users\noah office\Downloads\핫비디오 모음집(826개)_박노아 - 핫비디오 모음집.csv")
df = pd.read_csv(source, encoding="utf-8-sig")

for column in ["제목", "조회수", "채널명", "게시일"]:
    df[column] = df[column].fillna("").astype(str)


def parse_views(value):
    text = str(value).replace(",", "").strip()
    try:
        return int(float(text))
    except ValueError:
        return 0


df["조회수_num"] = df["조회수"].map(parse_views)

keywords = [
    "장사",
    "사장",
    "자영업",
    "소상공",
    "식당",
    "카페",
    "편의점",
    "커피",
    "고기",
    "정육",
    "배민",
    "배달",
    "창업",
    "폐업",
    "인테리어",
    "비용",
    "돈",
    "시간",
    "이유",
    "방법",
    "꿀팁",
    "후회",
    "공개",
]

pattern = "|".join(map(re.escape, keywords))
related = df[df["제목"].str.contains(pattern, case=False, regex=True)].sort_values("조회수_num", ascending=False).head(80)
top = df.sort_values("조회수_num", ascending=False).head(80)

output = Path(r"C:\Users\noah office\Documents\New project\hot_video_title_source.txt")
lines = [
    "핫비디오 제목 공식 참고 소스",
    "역할: 제목 훅/구조 참고용. 본문 내용은 베끼지 말고 카페/외식업 맥락으로 치환.",
    "",
    "[외식업/장사 관련 후보 상위]",
]

for _, row in related.head(50).iterrows():
    lines.append(
        f"- {row['제목']} / 조회수 {row['조회수']} / 채널 {row['채널명']} / 게시일 {row['게시일']}"
    )

lines += ["", "[전체 조회수 상위 제목 후보]"]

for _, row in top.head(30).iterrows():
    lines.append(f"- {row['제목']} / 조회수 {row['조회수']} / 채널 {row['채널명']}")

output.write_text("\n".join(lines), encoding="utf-8")
print(output)
print(f"related={len(related)} top={len(top)}")
